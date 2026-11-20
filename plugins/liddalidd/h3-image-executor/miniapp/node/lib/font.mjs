// TrueType 字体解析：给程序排字用（textoverlay.mjs）。只认 glyf 轮廓（.ttf、.ttc 里的 TrueType 字面），
// 不认 CFF 轮廓（.otf、冬青黑体这类）：listFaces 会把它们标成 cff，调用方跳过。
//
// 只读排字要用的几张表：head / hhea / maxp / hmtx / loca / cmap / name，外加可选的 OS/2。
// 字形轮廓按需读：系统黑体一个文件 56 MB，整份读进内存不划算，排一段字只用得到几百个字形。
import { open, readFile } from 'node:fs/promises';

// ---------------------------------------------------------------- 数据源

function bufferSource(buffer) {
  return {
    size: buffer.length,
    async read(offset, length) {
      if (offset < 0 || offset + length > buffer.length) throw new Error('font_out_of_range');
      return buffer.subarray(offset, offset + length);
    },
    async readMany(ranges) {
      return ranges.map(([offset, length]) => buffer.subarray(offset, offset + length));
    },
  };
}

function fileSource(path, size) {
  async function withHandle(fn) {
    const handle = await open(path, 'r');
    try {
      return await fn(handle);
    } finally {
      await handle.close();
    }
  }
  async function readAt(handle, offset, length) {
    const out = Buffer.alloc(length);
    let done = 0;
    while (done < length) {
      const { bytesRead } = await handle.read(out, done, length - done, offset + done);
      if (!bytesRead) throw new Error('font_out_of_range');
      done += bytesRead;
    }
    return out;
  }
  return {
    size,
    read: (offset, length) => withHandle((handle) => readAt(handle, offset, length)),
    readMany: (ranges) =>
      withHandle(async (handle) => {
        const out = [];
        for (const [offset, length] of ranges) out.push(await readAt(handle, offset, length));
        return out;
      }),
  };
}

// ---------------------------------------------------------------- 对外入口

// 列出一个字体文件里的全部字面（.ttc 有多个）。返回 [{ index, family, subfamily, outlines }]。
export async function listFaces(path) {
  const handle = await open(path, 'r');
  let size = 0;
  try {
    size = (await handle.stat()).size;
  } finally {
    await handle.close();
  }
  const source = fileSource(path, size);
  const offsets = await faceOffsets(source);
  const out = [];
  for (let index = 0; index < offsets.length; index += 1) {
    try {
      const tables = await readDirectory(source, offsets[index]);
      const names = tables.name ? parseNames(await source.read(tables.name.offset, tables.name.length)) : {};
      out.push({
        index,
        family: names.family || '',
        familyEn: names.familyEn || '',
        subfamily: names.subfamily || '',
        outlines: tables.glyf && tables.loca ? 'glyf' : tables['CFF '] || tables.CFF2 ? 'cff' : 'unknown',
      });
    } catch {
      out.push({ index, family: '', familyEn: '', subfamily: '', outlines: 'unknown' });
    }
  }
  return out;
}

// 打开一个字面。options.index：.ttc 里的第几个字面（默认 0）。
export async function openFont(path, options) {
  const handle = await open(path, 'r');
  let size = 0;
  try {
    size = (await handle.stat()).size;
  } finally {
    await handle.close();
  }
  return loadFace(fileSource(path, size), options, path);
}

// 整个文件读进来再解析：随包的字体只有几 MB，排一整篇长文时比按需读快。
export async function openFontFully(path, options) {
  return loadFace(bufferSource(await readFile(path)), options, path);
}

// ---------------------------------------------------------------- 解析

async function faceOffsets(source) {
  const head = await source.read(0, 12);
  const tag = head.toString('latin1', 0, 4);
  if (tag === 'ttcf') {
    const count = head.readUInt32BE(8);
    if (!count || count > 64) throw new Error('font_bad_ttc');
    const table = await source.read(12, count * 4);
    return Array.from({ length: count }, (_, i) => table.readUInt32BE(i * 4));
  }
  const version = head.readUInt32BE(0);
  if (version === 0x00010000 || tag === 'true' || tag === 'OTTO') return [0];
  throw new Error('font_unknown_format');
}

async function readDirectory(source, offset) {
  const head = await source.read(offset, 12);
  const count = head.readUInt16BE(4);
  if (!count || count > 128) throw new Error('font_bad_directory');
  const dir = await source.read(offset + 12, count * 16);
  const tables = {};
  for (let i = 0; i < count; i += 1) {
    const at = i * 16;
    tables[dir.toString('latin1', at, at + 4)] = { offset: dir.readUInt32BE(at + 8), length: dir.readUInt32BE(at + 12) };
  }
  return tables;
}

async function loadFace(source, options, path) {
  const index = Math.max(0, Number((options && options.index) || 0));
  const offsets = await faceOffsets(source);
  if (index >= offsets.length) throw new Error('font_no_such_face');
  const tables = await readDirectory(source, offsets[index]);
  for (const name of ['head', 'hhea', 'maxp', 'hmtx', 'cmap']) {
    if (!tables[name]) throw new Error('font_missing_table:' + name);
  }
  if (!tables.glyf || !tables.loca) throw new Error('font_not_truetype');
  const want = ['head', 'hhea', 'maxp', 'hmtx', 'loca', 'cmap', 'name', 'OS/2'].filter((name) => tables[name]);
  const blobs = await source.readMany(want.map((name) => [tables[name].offset, tables[name].length]));
  const data = {};
  want.forEach((name, i) => {
    data[name] = blobs[i];
  });

  const head = data.head;
  const unitsPerEm = head.readUInt16BE(18) || 1000;
  const longLoca = head.readInt16BE(50) === 1;
  const numGlyphs = data.maxp.readUInt16BE(4);
  const hhea = data.hhea;
  let ascender = hhea.readInt16BE(4);
  let descender = hhea.readInt16BE(6);
  const lineGap = hhea.readInt16BE(8);
  const numberOfHMetrics = hhea.readUInt16BE(34);
  if (data['OS/2'] && data['OS/2'].length >= 72) {
    const typoAsc = data['OS/2'].readInt16BE(68);
    const typoDesc = data['OS/2'].readInt16BE(70);
    if (typoAsc > 0 && typoDesc < 0) {
      ascender = typoAsc;
      descender = typoDesc;
    }
  }
  const hmtx = data.hmtx;
  const loca = data.loca;
  const locaAt = (gid) => (longLoca ? loca.readUInt32BE(gid * 4) : loca.readUInt16BE(gid * 2) * 2);
  const cmap = parseCmap(data.cmap);
  const names = data.name ? parseNames(data.name) : {};
  const glyfOffset = tables.glyf.offset;
  const glyfLength = tables.glyf.length;
  const outlines = new Map();

  function glyphId(codePoint) {
    return cmap(codePoint);
  }

  function advance(gid) {
    if (!numberOfHMetrics) return unitsPerEm;
    const at = Math.min(gid, numberOfHMetrics - 1) * 4;
    return hmtx.readUInt16BE(at);
  }

  function glyphRange(gid) {
    if (gid < 0 || gid >= numGlyphs) return null;
    const start = locaAt(gid);
    const end = locaAt(gid + 1);
    if (end <= start || start >= glyfLength) return null;
    return [glyfOffset + start, Math.min(end, glyfLength) - start];
  }

  // 把一批字形的轮廓读进来（含复合字形引用的部件，递归读）。
  async function loadGlyphs(gids) {
    const raw = new Map();
    let pending = [...new Set(gids)].filter((gid) => gid > 0 && !outlines.has(gid));
    while (pending.length) {
      const ranges = [];
      const order = [];
      for (const gid of pending) {
        if (raw.has(gid)) continue;
        const range = glyphRange(gid);
        if (!range) {
          raw.set(gid, null);
          continue;
        }
        ranges.push(range);
        order.push(gid);
      }
      const blobs = ranges.length ? await source.readMany(ranges) : [];
      const next = [];
      order.forEach((gid, i) => {
        const blob = Buffer.from(blobs[i]);
        raw.set(gid, blob);
        if (blob.length >= 10 && blob.readInt16BE(0) < 0) {
          for (const part of compositeParts(blob)) if (!raw.has(part) && !outlines.has(part)) next.push(part);
        }
      });
      pending = [...new Set(next)];
    }
    const resolve = (gid, depth) => {
      if (outlines.has(gid)) return outlines.get(gid);
      const blob = raw.get(gid);
      let outline = null;
      if (blob && blob.length >= 10) {
        outline = blob.readInt16BE(0) >= 0 ? parseSimple(blob) : depth < 8 ? parseComposite(blob, (part) => resolve(part, depth + 1)) : null;
      }
      outlines.set(gid, outline || EMPTY);
      return outlines.get(gid);
    };
    for (const gid of gids) if (gid > 0) resolve(gid, 0);
  }

  // 排字前一次性把要用的字形读好。返回缺字（字体里没有的字符）。
  async function prepare(text) {
    const gids = [];
    const missing = [];
    for (const ch of new Set(Array.from(String(text || '')))) {
      const cp = ch.codePointAt(0);
      if (cp <= 0x20 || cp === 0x3000) continue;
      const gid = glyphId(cp);
      if (gid) gids.push(gid);
      else missing.push(ch);
    }
    await loadGlyphs(gids);
    return missing;
  }

  function outline(gid) {
    const hit = outlines.get(gid);
    return hit && hit !== EMPTY ? hit : null;
  }

  return {
    path,
    index,
    family: names.family || names.familyEn || '',
    familyEn: names.familyEn || '',
    subfamily: names.subfamily || '',
    unitsPerEm,
    ascender,
    descender,
    lineGap,
    numGlyphs,
    glyphId,
    has: (ch) => Boolean(glyphId(String(ch).codePointAt(0))),
    advance,
    loadGlyphs,
    prepare,
    outline,
  };
}

const EMPTY = Object.freeze({ contours: [], xMin: 0, yMin: 0, xMax: 0, yMax: 0, empty: true });

// cmap：优先 Unicode 全平面（格式 12），其次 BMP（格式 4）。返回 codePoint -> glyphId 的查找函数。
function parseCmap(table) {
  const count = table.readUInt16BE(2);
  let best = null;
  let bestRank = -1;
  for (let i = 0; i < count; i += 1) {
    const platform = table.readUInt16BE(4 + i * 8);
    const encoding = table.readUInt16BE(6 + i * 8);
    const offset = table.readUInt32BE(8 + i * 8);
    if (offset + 2 > table.length) continue;
    const format = table.readUInt16BE(offset);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;
    const rank = format === 12 ? 2 : format === 4 ? 1 : -1;
    if (rank > bestRank) {
      best = { offset, format };
      bestRank = rank;
    }
  }
  if (!best) return () => 0;
  const base = best.offset;
  if (best.format === 12) {
    const groups = table.readUInt32BE(base + 12);
    const starts = new Uint32Array(groups);
    const ends = new Uint32Array(groups);
    const glyphs = new Uint32Array(groups);
    for (let g = 0; g < groups; g += 1) {
      const at = base + 16 + g * 12;
      starts[g] = table.readUInt32BE(at);
      ends[g] = table.readUInt32BE(at + 4);
      glyphs[g] = table.readUInt32BE(at + 8);
    }
    return (cp) => {
      let lo = 0;
      let hi = groups - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (cp < starts[mid]) hi = mid - 1;
        else if (cp > ends[mid]) lo = mid + 1;
        else return glyphs[mid] + (cp - starts[mid]);
      }
      return 0;
    };
  }
  const segCount = table.readUInt16BE(base + 6) / 2;
  const endAt = base + 14;
  const startAt = endAt + segCount * 2 + 2;
  const deltaAt = startAt + segCount * 2;
  const rangeAt = deltaAt + segCount * 2;
  return (cp) => {
    if (cp > 0xffff) return 0;
    let lo = 0;
    let hi = segCount - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const end = table.readUInt16BE(endAt + mid * 2);
      const start = table.readUInt16BE(startAt + mid * 2);
      if (cp > end) lo = mid + 1;
      else if (cp < start) hi = mid - 1;
      else {
        const delta = table.readInt16BE(deltaAt + mid * 2);
        const rangeOffset = table.readUInt16BE(rangeAt + mid * 2);
        if (!rangeOffset) return (cp + delta) & 0xffff;
        const at = rangeAt + mid * 2 + rangeOffset + (cp - start) * 2;
        if (at + 2 > table.length) return 0;
        const gid = table.readUInt16BE(at);
        return gid ? (gid + delta) & 0xffff : 0;
      }
    }
    return 0;
  };
}

// name 表：字族名（优先简体中文，其次英文）和字重名。
function parseNames(table) {
  const count = table.readUInt16BE(2);
  const storage = table.readUInt16BE(4);
  const found = {};
  for (let i = 0; i < count; i += 1) {
    const at = 6 + i * 12;
    if (at + 12 > table.length) break;
    const platform = table.readUInt16BE(at);
    const language = table.readUInt16BE(at + 4);
    const nameId = table.readUInt16BE(at + 6);
    const length = table.readUInt16BE(at + 8);
    const offset = table.readUInt16BE(at + 10);
    if (platform !== 3 || (nameId !== 1 && nameId !== 2 && nameId !== 16)) continue;
    const start = storage + offset;
    if (start + length > table.length) continue;
    const value = Buffer.from(table.subarray(start, start + length)).swap16().toString('utf16le');
    const key = nameId === 2 ? 'subfamily' : 'family';
    if (language === 0x0804) found[key + 'Zh'] = found[key + 'Zh'] || value;
    else if (language === 0x0409) found[key + 'En'] = nameId === 16 ? value : found[key + 'En'] || value;
    else found[key + 'Any'] = found[key + 'Any'] || value;
  }
  return {
    family: found.familyZh || found.familyEn || found.familyAny || '',
    familyEn: found.familyEn || found.familyAny || '',
    subfamily: found.subfamilyEn || found.subfamilyZh || found.subfamilyAny || '',
  };
}

// 简单字形：轮廓点（on = 是否在曲线上）。坐标是字体单位，y 轴朝上。
function parseSimple(blob) {
  const contoursCount = blob.readInt16BE(0);
  const box = { xMin: blob.readInt16BE(2), yMin: blob.readInt16BE(4), xMax: blob.readInt16BE(6), yMax: blob.readInt16BE(8) };
  if (!contoursCount) return { contours: [], ...box };
  let at = 10;
  const ends = [];
  for (let i = 0; i < contoursCount; i += 1, at += 2) ends.push(blob.readUInt16BE(at));
  const points = ends[ends.length - 1] + 1;
  const instructionLength = blob.readUInt16BE(at);
  at += 2 + instructionLength;
  const flags = new Uint8Array(points);
  for (let i = 0; i < points; ) {
    const flag = blob[at++];
    flags[i++] = flag;
    if (flag & 8) {
      let repeat = blob[at++];
      while (repeat-- > 0 && i < points) flags[i++] = flag;
    }
  }
  const xs = new Int32Array(points);
  const ys = new Int32Array(points);
  let value = 0;
  for (let i = 0; i < points; i += 1) {
    const flag = flags[i];
    if (flag & 2) {
      const delta = blob[at++];
      value += flag & 16 ? delta : -delta;
    } else if (!(flag & 16)) {
      value += blob.readInt16BE(at);
      at += 2;
    }
    xs[i] = value;
  }
  value = 0;
  for (let i = 0; i < points; i += 1) {
    const flag = flags[i];
    if (flag & 4) {
      const delta = blob[at++];
      value += flag & 32 ? delta : -delta;
    } else if (!(flag & 32)) {
      value += blob.readInt16BE(at);
      at += 2;
    }
    ys[i] = value;
  }
  const contours = [];
  let startPoint = 0;
  for (const end of ends) {
    const contour = [];
    for (let i = startPoint; i <= end; i += 1) contour.push({ x: xs[i], y: ys[i], on: Boolean(flags[i] & 1) });
    if (contour.length) contours.push(contour);
    startPoint = end + 1;
  }
  return { contours, ...box };
}

function compositeParts(blob) {
  const parts = [];
  let at = 10;
  for (let guard = 0; guard < 64; guard += 1) {
    if (at + 4 > blob.length) break;
    const flags = blob.readUInt16BE(at);
    parts.push(blob.readUInt16BE(at + 2));
    at += 4 + (flags & 1 ? 4 : 2);
    if (flags & 8) at += 2;
    else if (flags & 0x40) at += 4;
    else if (flags & 0x80) at += 8;
    if (!(flags & 0x20)) break;
  }
  return parts;
}

const f2dot14 = (blob, at) => blob.readInt16BE(at) / 16384;

// 复合字形：把部件的轮廓按各自的变换拼起来。
function parseComposite(blob, resolve) {
  const box = { xMin: blob.readInt16BE(2), yMin: blob.readInt16BE(4), xMax: blob.readInt16BE(6), yMax: blob.readInt16BE(8) };
  const contours = [];
  const placed = [];
  let at = 10;
  for (let guard = 0; guard < 64; guard += 1) {
    if (at + 4 > blob.length) break;
    const flags = blob.readUInt16BE(at);
    const gid = blob.readUInt16BE(at + 2);
    at += 4;
    let arg1;
    let arg2;
    if (flags & 1) {
      arg1 = flags & 2 ? blob.readInt16BE(at) : blob.readUInt16BE(at);
      arg2 = flags & 2 ? blob.readInt16BE(at + 2) : blob.readUInt16BE(at + 2);
      at += 4;
    } else {
      arg1 = flags & 2 ? blob.readInt8(at) : blob[at];
      arg2 = flags & 2 ? blob.readInt8(at + 1) : blob[at + 1];
      at += 2;
    }
    let a = 1;
    let b = 0;
    let c = 0;
    let d = 1;
    if (flags & 8) {
      a = d = f2dot14(blob, at);
      at += 2;
    } else if (flags & 0x40) {
      a = f2dot14(blob, at);
      d = f2dot14(blob, at + 2);
      at += 4;
    } else if (flags & 0x80) {
      a = f2dot14(blob, at);
      b = f2dot14(blob, at + 2);
      c = f2dot14(blob, at + 4);
      d = f2dot14(blob, at + 6);
      at += 8;
    }
    const part = resolve(gid);
    if (part && part.contours.length) {
      const transformed = part.contours.map((contour) =>
        contour.map((p) => ({ x: a * p.x + c * p.y, y: b * p.x + d * p.y, on: p.on })),
      );
      let dx = 0;
      let dy = 0;
      if (flags & 2) {
        dx = arg1;
        dy = arg2;
        // 0x800（SCALED_COMPONENT_OFFSET）：偏移量也要跟着缩放（苹果的约定）。
        if (flags & 0x800) {
          dx = a * arg1 + c * arg2;
          dy = b * arg1 + d * arg2;
        }
      } else {
        // 点对齐：父字形的第 arg1 个点和这个部件的第 arg2 个点重合。
        const flat = transformed.flat();
        const parentPoint = placed[arg1];
        const childPoint = flat[arg2];
        if (parentPoint && childPoint) {
          dx = parentPoint.x - childPoint.x;
          dy = parentPoint.y - childPoint.y;
        }
      }
      for (const contour of transformed) {
        const moved = contour.map((p) => ({ x: p.x + dx, y: p.y + dy, on: p.on }));
        contours.push(moved);
        placed.push(...moved);
      }
    }
    if (!(flags & 0x20)) break;
  }
  return { contours, ...box };
}
