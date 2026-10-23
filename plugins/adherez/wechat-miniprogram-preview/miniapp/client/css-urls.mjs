function quotedEnd(source, start) {
  const quote = source[start];
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === '\\') index += 2;
    else if (source[index++] === quote) return index;
  }
  return -1;
}

function decodeCssString(source) {
  return source.replace(/\\(?:([\da-f]{1,6})(?:\r\n|[\t\n\r\f ])?|\r\n|[\n\r\f]|([\s\S]))/gi, (_match, hexadecimal, escaped) => {
    if (hexadecimal) {
      const code = parseInt(hexadecimal, 16);
      return code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? '\ufffd' : String.fromCodePoint(code);
    }
    return escaped || '';
  });
}

function quoteCssString(source) {
  return '"' + source.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\n\r\f]/g, (char) => '\\' + char.charCodeAt(0).toString(16) + ' ') + '"';
}

// transform receives the decoded resource name, not CSS escape syntax. Unchanged
// values retain their original bytes; changed URLs are serialized exactly once.
export function rewriteCssUrls(value, transform) {
  const source = String(value);
  let index = 0;
  let output = '';
  while (index < source.length) {
    const char = source[index];
    if (char === '"' || char === "'") {
      const end = quotedEnd(source, index);
      if (end < 0) { output += source.slice(index); break; }
      output += source.slice(index, end); index = end; continue;
    }
    if (source.startsWith('/*', index)) {
      const close = source.indexOf('*/', index + 2);
      const end = close < 0 ? source.length : close + 2;
      output += source.slice(index, end); index = end; continue;
    }
    if ((index === 0 || !/[\w-]/.test(source[index - 1])) && /^url\s*\(/i.test(source.slice(index))) {
      const open = source.indexOf('(', index);
      let start = open + 1;
      while (start < source.length && /\s/.test(source[start])) start++;
      const quoted = source[start] === '"' || source[start] === "'";
      let end = quoted ? quotedEnd(source, start) : start;
      if (!quoted) while (end < source.length && source[end] !== ')') end += source[end] === '\\' ? 2 : 1;
      if (end < 0 || end >= source.length) { output += source.slice(index); break; }
      let close = end;
      while (close < source.length && /\s/.test(source[close])) close++;
      if (source[close] !== ')') { output += source[index++]; continue; }
      const raw = quoted ? source.slice(start + 1, end - 1) : source.slice(start, end).trim();
      const decoded = decodeCssString(raw);
      const result = transform(decoded);
      output += typeof result !== 'string' || result === decoded ? source.slice(index, close + 1) : 'url(' + quoteCssString(result) + ')';
      index = close + 1;
      continue;
    }
    output += source[index++];
  }
  return output;
}
