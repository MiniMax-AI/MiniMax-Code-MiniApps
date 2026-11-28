// PDF text extraction without third-party dependencies.
// Handles object streams, FlateDecode, per-font ToUnicode CMaps and the usual text operators.

import { inflateSync, inflateRawSync } from 'node:zlib';

const MAX_PAGES = 500;

/**
 * @param {Buffer} buffer
 * @returns {{ text: string, pages: number, title: string }}
 */
export function parsePdf(buffer) {
  // latin1 keeps a 1:1 byte<->char mapping, so string offsets equal byte offsets.
  const text = buffer.toString('latin1');
  if (!text.includes('%PDF-')) throw new Error('pdf_header_missing');
  if (/\/Encrypt\b/.test(text)) throw new Error('pdf_encrypted_not_supported');

  const objects = collectObjects(text);
  expandObjectStreams(objects);
  const pages = collectPages(objects);
  if (!pages.length) throw new Error('pdf_no_page_found');

  const blocks = [];
  let extracted = 0;
  for (const page of pages.slice(0, MAX_PAGES)) {
    const content = pageContent(objects, page);
    if (!content || !content.length) continue;
    const fonts = pageFonts(objects, page);
    const pageText = extractText(content, fonts);
    if (pageText.trim()) {
      extracted += 1;
      blocks.push(pageText);
    }
  }

  if (!extracted) {
    throw new Error('pdf_no_text_layer_found');
  }
  const joined = blocks.join('\n\n');
  return { text: joined, pages: pages.length, title: documentTitle(objects) };
}

/* ------------------------------------------------------------------ objects */

function collectObjects(text) {
  const objects = new Map();
  const pattern = /(\d+)\s+(\d+)\s+obj\b/g;
  let matched = pattern.exec(text);
  while (matched) {
    const number = Number(matched[1]);
    const bodyStart = matched.index + matched[0].length;
    const head = text.slice(bodyStart, bodyStart + 4000);
    const streamMatch = /\bstream\r?\n/.exec(head);
    let dict;
    let stream = null;
    if (streamMatch) {
      const dictEnd = bodyStart + streamMatch.index;
      dict = text.slice(bodyStart, dictEnd);
      const dataStart = dictEnd + streamMatch[0].length;
      const endStream = text.indexOf('endstream', dataStart);
      let dataEnd = endStream < 0 ? text.length : endStream;
      if (text[dataEnd - 1] === '\n') dataEnd -= 1;
      if (text[dataEnd - 1] === '\r') dataEnd -= 1;
      stream = decodeStream(dict, Buffer.from(text.slice(dataStart, dataEnd), 'latin1'));
    } else {
      const endObj = text.indexOf('endobj', bodyStart);
      dict = text.slice(bodyStart, endObj < 0 ? text.length : endObj);
    }
    if (!objects.has(number)) objects.set(number, { number, dict, stream });
    matched = pattern.exec(text);
  }
  return objects;
}

function decodeStream(dict, raw) {
  if (!raw.length) return null;
  const filter = /\/Filter\s*(?:\/\w+|\[[^\]]*\])/.exec(dict);
  const filterText = filter ? filter[0] : '';
  if (!filterText) return raw;
  if (!/FlateDecode/.test(filterText)) return null;
  let inflated = null;
  try {
    inflated = inflateSync(raw);
  } catch {
    try {
      inflated = inflateRawSync(raw);
    } catch {
      return null;
    }
  }
  return applyPredictor(dict, inflated);
}

function applyPredictor(dict, data) {
  const predictor = Number((/\/Predictor\s+(\d+)/.exec(dict) || [])[1] || 1);
  if (!predictor || predictor < 2) return data;
  const columns = Number((/\/Columns\s+(\d+)/.exec(dict) || [])[1] || 1);
  const colors = Number((/\/Colors\s+(\d+)/.exec(dict) || [])[1] || 1);
  const bpc = Number((/\/BitsPerComponent\s+(\d+)/.exec(dict) || [])[1] || 8);
  const bpp = Math.max(1, (colors * bpc) / 8);
  const rowLength = Math.ceil((columns * colors * bpc) / 8);
  if (predictor === 2) {
    if (bpc !== 8) return data;
    const rows = Math.floor(data.length / rowLength);
    for (let row = 0; row < rows; row += 1) {
      const base = row * rowLength;
      for (let index = bpp; index < rowLength; index += 1) {
        data[base + index] = (data[base + index] + data[base + index - bpp]) & 0xff;
      }
    }
    return data;
  }
  // PNG predictors: each row is prefixed with a filter type byte.
  const stride = rowLength + 1;
  const rows = Math.floor(data.length / stride);
  const out = Buffer.alloc(rows * rowLength);
  let previous = Buffer.alloc(rowLength);
  for (let row = 0; row < rows; row += 1) {
    const filterType = data[row * stride];
    const source = data.subarray(row * stride + 1, row * stride + 1 + rowLength);
    const target = out.subarray(row * rowLength, (row + 1) * rowLength);
    source.copy(target);
    for (let index = 0; index < rowLength; index += 1) {
      const left = index >= bpp ? target[index - bpp] : 0;
      const up = previous[index];
      const upLeft = index >= bpp ? previous[index - bpp] : 0;
      if (filterType === 1) target[index] = (target[index] + left) & 0xff;
      else if (filterType === 2) target[index] = (target[index] + up) & 0xff;
      else if (filterType === 3) target[index] = (target[index] + ((left + up) >> 1)) & 0xff;
      else if (filterType === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const value = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        target[index] = (target[index] + value) & 0xff;
      }
    }
    target.copy(previous);
  }
  return out;
}

function expandObjectStreams(objects) {
  for (const object of [...objects.values()]) {
    if (!/\/Type\s*\/ObjStm/.test(object.dict) || !object.stream) continue;
    const count = Number((/\/N\s+(\d+)/.exec(object.dict) || [])[1] || 0);
    const first = Number((/\/First\s+(\d+)/.exec(object.dict) || [])[1] || 0);
    if (!count || !first) continue;
    const content = object.stream.toString('latin1');
    const header = content.slice(0, first).trim().split(/\s+/).map(Number);
    for (let index = 0; index < count; index += 1) {
      const number = header[index * 2];
      const relativeOffset = header[index * 2 + 1];
      if (!Number.isFinite(number) || !Number.isFinite(relativeOffset)) continue;
      const nextOffset = index + 1 < count ? header[(index + 1) * 2 + 1] : content.length - first;
      const body = content.slice(first + relativeOffset, first + nextOffset);
      if (!objects.has(number)) objects.set(number, { number, dict: body, stream: null });
    }
  }
}

/* -------------------------------------------------------------------- pages */

function collectPages(objects) {
  const pages = [];
  let rootNumber = null;
  for (const object of objects.values()) {
    if (/\/Type\s*\/Catalog/.test(object.dict)) {
      const reference = /\/Pages\s+(\d+)\s+\d+\s+R/.exec(object.dict);
      if (reference) rootNumber = Number(reference[1]);
    }
  }
  if (rootNumber !== null) {
    walkPageTree(objects, rootNumber, null, pages, 0);
  }
  if (!pages.length) {
    for (const object of objects.values()) {
      if (/\/Type\s*\/Page\b/.test(object.dict)) pages.push({ number: object.number, dict: object.dict, inherited: null });
    }
  }
  return pages;
}

function walkPageTree(objects, number, inherited, out, depth) {
  if (depth > 64 || out.length >= MAX_PAGES) return;
  const object = objects.get(number);
  if (!object) return;
  const dict = object.dict;
  if (/\/Type\s*\/Page\b/.test(dict)) {
    out.push({ number, dict, inherited });
    return;
  }
  let resources = inherited;
  const resourceReference = /\/Resources\s+(\d+)\s+\d+\s+R/.exec(dict);
  if (resourceReference) {
    const resourceObject = objects.get(Number(resourceReference[1]));
    if (resourceObject) resources = resourceObject.dict;
  }
  const kids = /\/Kids\s*\[([^\]]*)\]/.exec(dict);
  if (!kids) return;
  const references = [...kids[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((match) => Number(match[1]));
  for (const reference of references) walkPageTree(objects, reference, resources, out, depth + 1);
}

function pageContent(objects, page) {
  const arrayMatch = /\/Contents\s*\[([^\]]*)\]/.exec(page.dict);
  if (arrayMatch) {
    const references = [...arrayMatch[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((match) => Number(match[1]));
    const parts = references.map((reference) => objects.get(reference)?.stream).filter(Boolean);
    return parts.length ? Buffer.concat(parts) : null;
  }
  const reference = /\/Contents\s+(\d+)\s+\d+\s+R/.exec(page.dict);
  if (reference) return objects.get(Number(reference[1]))?.stream || null;
  return null;
}

function pageFonts(objects, page) {
  const fonts = new Map();
  let resources = page.inherited;
  if (!resources) resources = extractInlineDict(page.dict, '/Resources');
  if (!resources) return fonts;
  let fontDictionary = null;
  const fontReference = /\/Font\s+(\d+)\s+\d+\s+R/.exec(resources);
  if (fontReference) fontDictionary = objects.get(Number(fontReference[1]))?.dict || null;
  else fontDictionary = extractInlineDict(resources, '/Font');
  if (!fontDictionary) return fonts;

  const pattern = /\/([A-Za-z0-9_.#+-]+)\s+(\d+)\s+\d+\s+R/g;
  let matched = pattern.exec(fontDictionary);
  while (matched) {
    const name = `/${matched[1]}`;
    const fontObject = objects.get(Number(matched[2]));
    const toUnicodeReference = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(fontObject?.dict || '');
    let cmap = null;
    if (toUnicodeReference) {
      const cmapObject = objects.get(Number(toUnicodeReference[1]));
      if (cmapObject?.stream) cmap = parseCMap(cmapObject.stream.toString('latin1'));
    }
    fonts.set(name, cmap);
    matched = pattern.exec(fontDictionary);
  }
  return fonts;
}

function extractInlineDict(dictionary, key) {
  const index = dictionary.indexOf(key);
  if (index < 0) return null;
  const start = dictionary.indexOf('<<', index);
  if (start < 0) return null;
  let depth = 0;
  let cursor = start;
  while (cursor < dictionary.length - 1) {
    if (dictionary[cursor] === '<' && dictionary[cursor + 1] === '<') {
      depth += 1;
      cursor += 2;
      continue;
    }
    if (dictionary[cursor] === '>' && dictionary[cursor + 1] === '>') {
      depth -= 1;
      cursor += 2;
      if (depth === 0) return dictionary.slice(start, cursor);
      continue;
    }
    cursor += 1;
  }
  return null;
}

/* --------------------------------------------------------------------- CMaps */

function parseCMap(source) {
  const map = new Map();
  let codeBytes = 1;

  const charPattern = /beginbfchar([\s\S]*?)endbfchar/g;
  let section = charPattern.exec(source);
  while (section) {
    const pairs = [...section[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)];
    for (const pair of pairs) {
      codeBytes = Math.max(codeBytes, pair[1].length > 2 ? 2 : 1);
      map.set(Number.parseInt(pair[1], 16), hexToUtf16(pair[2]));
    }
    section = charPattern.exec(source);
  }

  const rangePattern = /beginbfrange([\s\S]*?)endbfrange/g;
  section = rangePattern.exec(source);
  while (section) {
    const body = section[1];
    const pattern = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([\s\S]*?)\])/g;
    let matched = pattern.exec(body);
    while (matched) {
      const low = Number.parseInt(matched[1], 16);
      const high = Number.parseInt(matched[2], 16);
      codeBytes = Math.max(codeBytes, matched[1].length > 2 ? 2 : 1);
      if (matched[3]) {
        const baseValue = Number.parseInt(matched[3], 16);
        const width = matched[3].length;
        for (let code = low; code <= high && code - low < 65536; code += 1) {
          const shifted = (baseValue + (code - low)).toString(16).padStart(width, '0');
          map.set(code, hexToUtf16(shifted));
        }
      } else if (matched[4]) {
        const items = [...matched[4].matchAll(/<([0-9A-Fa-f]+)>/g)].map((item) => item[1]);
        items.forEach((item, index) => map.set(low + index, hexToUtf16(item)));
      }
      matched = pattern.exec(body);
    }
    section = rangePattern.exec(source);
  }

  const spacePattern = /begincodespacerange([\s\S]*?)endcodespacerange/g;
  section = spacePattern.exec(source);
  while (section) {
    const ranges = [...section[1].matchAll(/<([0-9A-Fa-f]+)>/g)];
    for (const range of ranges) {
      codeBytes = Math.max(codeBytes, range[1].length > 2 ? 2 : 1);
    }
    section = spacePattern.exec(source);
  }

  return { map, codeBytes };
}

function hexToUtf16(hex) {
  const clean = String(hex).replace(/\s+/g, '');
  const padded = clean.length % 2 === 0 ? clean : `${clean}0`;
  const bytes = Buffer.from(padded, 'hex');
  const swapped = Buffer.from(bytes);
  if (swapped.length >= 2) swapped.swap16();
  return swapped.toString('utf16le');
}

/* ------------------------------------------------------------- text operators */

function extractText(content, fonts) {
  const source = content.toString('latin1');
  let out = '';
  let cmap = null;
  let cursor = 0;
  const operands = [];

  const flushOperator = (operator) => {
    switch (operator) {
      case 'Tf': {
        const name = operands.find((item) => item.type === 'name');
        if (name) cmap = fonts.get(`/${name.value}`) || null;
        break;
      }
      case 'Tj': {
        const text = operands.find((item) => item.type === 'string');
        if (text) out += decodeBytes(text.value, cmap);
        break;
      }
      case 'TJ': {
        const array = operands.find((item) => item.type === 'array');
        if (array) {
          for (const item of array.items) {
            if (item.type === 'string') out += decodeBytes(item.value, cmap);
            else if (item.type === 'number' && item.value <= -120) out += ' ';
          }
        }
        break;
      }
      case "'": {
        const text = operands.find((item) => item.type === 'string');
        if (text) out += decodeBytes(text.value, cmap) + '\n';
        break;
      }
      case '"': {
        const text = operands.find((item) => item.type === 'string');
        if (text) out += decodeBytes(text.value, cmap) + '\n';
        break;
      }
      case 'Td':
      case 'TD': {
        const numbers = operands.filter((item) => item.type === 'number');
        const ty = numbers.length >= 2 ? numbers[numbers.length - 1].value : 0;
        const tx = numbers.length >= 2 ? numbers[numbers.length - 2].value : 0;
        if (ty !== 0) out += '\n';
        else if (tx !== 0) out += ' ';
        break;
      }
      case 'Tm': {
        const numbers = operands.filter((item) => item.type === 'number');
        const fy = numbers.length >= 6 ? numbers[5].value : 0;
        if (fy !== 0) out += '\n';
        break;
      }
      case 'T*':
        out += '\n';
        break;
      default:
        break;
    }
    operands.length = 0;
  };

  while (cursor < source.length) {
    const char = source[cursor];
    if (char === '(') {
      const literal = readLiteralString(source, cursor);
      operands.push({ type: 'string', value: literal.value });
      cursor = literal.next;
      continue;
    }
    if (char === '<' && source[cursor + 1] !== '<') {
      const end = source.indexOf('>', cursor);
      if (end < 0) break;
      const hex = source.slice(cursor + 1, end).replace(/\s+/g, '');
      const padded = hex.length % 2 === 0 ? hex : `${hex}0`;
      operands.push({ type: 'string', value: Buffer.from(padded, 'hex') });
      cursor = end + 1;
      continue;
    }
    if (char === '<') {
      const end = source.indexOf('>>', cursor);
      cursor = end < 0 ? source.length : end + 2;
      continue;
    }
    if (char === '[') {
      operands.push({ type: 'array', items: [] });
      cursor += 1;
      continue;
    }
    if (char === ']') {
      for (let index = operands.length - 1; index >= 0; index -= 1) {
        if (operands[index].type === 'array') {
          const items = operands.slice(index + 1);
          operands.length = index;
          operands[index].items = items;
          break;
        }
      }
      cursor += 1;
      continue;
    }
    if (char === '/') {
      const matched = /^\/([^\s/[\]<>(){}%]+)/.exec(source.slice(cursor));
      if (matched) {
        operands.push({ type: 'name', value: matched[1] });
        cursor += matched[0].length;
        continue;
      }
    }
    const numberMatch = /^[+-]?(\d+\.?\d*|\.\d+)/.exec(source.slice(cursor));
    if (numberMatch) {
      operands.push({ type: 'number', value: Number.parseFloat(numberMatch[0]) });
      cursor += numberMatch[0].length;
      continue;
    }
    const operatorMatch = /^[A-Za-z'"*][A-Za-z0-9*'"]*/.exec(source.slice(cursor));
    if (operatorMatch) {
      flushOperator(operatorMatch[0]);
      cursor += operatorMatch[0].length;
      continue;
    }
    cursor += 1;
  }

  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function readLiteralString(source, start) {
  const bytes = [];
  let cursor = start + 1;
  let depth = 1;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === '\\') {
      const next = source[cursor + 1];
      const escapes = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
      if (next in escapes) {
        bytes.push(escapes[next]);
        cursor += 2;
        continue;
      }
      if (next === '\n') {
        cursor += 2;
        continue;
      }
      if (next === '\r') {
        cursor += source[cursor + 2] === '\n' ? 3 : 2;
        continue;
      }
      const octal = /^[0-7]{1,3}/.exec(source.slice(cursor + 1));
      if (octal) {
        bytes.push(Number.parseInt(octal[0], 8) & 0xff);
        cursor += 1 + octal[0].length;
        continue;
      }
      bytes.push(next ? next.charCodeAt(0) : 92);
      cursor += 2;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        cursor += 1;
        break;
      }
    }
    bytes.push(source.charCodeAt(cursor) & 0xff);
    cursor += 1;
  }
  return { value: Buffer.from(bytes), next: cursor };
}

function decodeBytes(bytes, cmap) {
  if (!bytes.length) return '';
  if (!cmap || !cmap.map.size) {
    const utf8 = bytes.toString('utf8');
    return utf8.includes('\ufffd') ? bytes.toString('latin1') : utf8;
  }
  const width = Math.max(1, cmap.codeBytes);
  let out = '';
  for (let index = 0; index < bytes.length; index += width) {
    let code = 0;
    for (let offset = 0; offset < width; offset += 1) {
      code = (code << 8) | (bytes[index + offset] || 0);
    }
    const mapped = cmap.map.get(code);
    if (mapped !== undefined) out += mapped;
  }
  return out;
}

function documentTitle(objects) {
  for (const object of objects.values()) {
    const match = /\/Title\s*\(([^)]*)\)/.exec(object.dict || '');
    if (match) return match[1];
  }
  return '';
}
