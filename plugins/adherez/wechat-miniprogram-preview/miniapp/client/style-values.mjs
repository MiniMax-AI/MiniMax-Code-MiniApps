function quotedEnd(source, start) {
  const quote = source[start];
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === '\\') index += 2;
    else if (source[index++] === quote) return index;
  }
  return source.length;
}

function functionEnd(source, open) {
  let depth = 1;
  let index = open + 1;
  while (index < source.length) {
    const char = source[index];
    if (char === '"' || char === "'") index = quotedEnd(source, index);
    else if (char === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      index = end < 0 ? source.length : end + 2;
    } else if (char === '\\') index += 2;
    else {
      index++;
      if (char === '(') depth++;
      if (char === ')' && --depth === 0) return index;
    }
  }
  return source.length;
}

// One conversion path serves compiled WXSS, inline styles and placeholders.
// CSS data strings, comments and resource URLs remain byte-for-byte unchanged.
export function convertStyleValues(value) {
  const source = String(value);
  let out = '';
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === '"' || char === "'") {
      const end = quotedEnd(source, index);
      out += source.slice(index, end);
      index = end;
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      const close = source.indexOf('*/', index + 2);
      const end = close < 0 ? source.length : close + 2;
      out += source.slice(index, end);
      index = end;
      continue;
    }
    const boundary = index === 0 || !/[\w.\\-]/.test(source[index - 1]);
    if (boundary) {
      const fn = /^(url|env|constant)\s*\(/i.exec(source.slice(index));
      if (fn) {
        const open = index + fn[0].length - 1;
        const end = functionEnd(source, open);
        if (fn[1].toLowerCase() === 'url') out += source.slice(index, end);
        else {
          const body = source.slice(open + 1, end - 1).trim();
          const safe = /^safe-area-inset-(top|right|bottom|left)(?:\s*,[\s\S]*)?$/i.exec(body);
          out += safe && source[end - 1] === ')' ? `var(--wx-safe-area-inset-${safe[1].toLowerCase()})` : source.slice(index, end);
        }
        index = end;
        continue;
      }
      const unit = /^(-?(?:\d+\.?\d*|\.\d+))(rpx|svh|lvh|dvh|vh)\b/i.exec(source.slice(index));
      if (unit) {
        out += Number(unit[1]) === 0 ? '0' : `calc(${unit[1]} * var(--wx-${unit[2].toLowerCase() === 'rpx' ? 'rpx' : 'vh'}))`;
        index += unit[0].length;
        continue;
      }
    }
    out += char;
    index++;
  }
  return out;
}
