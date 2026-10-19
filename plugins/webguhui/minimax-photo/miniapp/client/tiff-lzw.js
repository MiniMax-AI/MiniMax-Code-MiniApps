// TIFF 6.0 section 13: MSB-first codes with early width changes, unlike GIF LZW.
export function unpackLZW(source, size, fail) {
  const out = new Uint8Array(size),
    prefix = new Uint16Array(4096),
    suffix = new Uint8Array(4096),
    stack = new Uint8Array(4096);
  let bit = 0,
    width = 9,
    next = 258,
    previous = -1,
    first = 0,
    written = 0,
    initialized = false;
  function readCode() {
    if (bit + width > source.length * 8) fail('LZW 数据不完整');
    let code = 0;
    for (let i = 0; i < width; i++, bit++)
      code = (code << 1) | ((source[bit >>> 3] >>> (7 - (bit & 7))) & 1);
    return code;
  }
  while (true) {
    let code = readCode();
    if (code === 256) {
      width = 9;
      next = 258;
      previous = -1;
      initialized = true;
      continue;
    }
    if (!initialized) fail('LZW 缺少起始标记');
    if (code === 257) {
      if (written !== size) fail('LZW 像素不足');
      return out;
    }
    const original = code;
    let count = 0;
    if (code === next && previous >= 0) {
      stack[count++] = first;
      code = previous;
    } else if (code >= next) fail('LZW 字典索引无效');
    while (code >= 258) {
      if (count >= stack.length - 1) fail('LZW 字典链无效');
      stack[count++] = suffix[code];
      code = prefix[code];
    }
    if (code > 255) fail('LZW 字典内容无效');
    first = code;
    stack[count++] = first;
    if (written + count > size) fail('LZW 像素超过图像尺寸');
    while (count) out[written++] = stack[--count];
    if (previous >= 0 && next < 4096) {
      prefix[next] = previous;
      suffix[next] = first;
      next++;
      if (width < 12 && next === (1 << width) - 1) width++;
    }
    previous = original;
  }
}
