import { unpackLZW } from './tiff-lzw.js';
// Bounded TIFF 6.0 strip reader; unsupported encodings fail before pixel allocation.
export function readTIFF(buffer) {
  const v = new DataView(buffer),
    bytes = new Uint8Array(buffer);
  const fail = (message) => {
    throw Error('TIFF：' + message);
  };
  const range = (offset, count) => {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(count) ||
      offset < 0 ||
      count < 0 ||
      offset + count > bytes.length
    )
      fail('文件数据不完整');
  };
  range(0, 8);
  const le = bytes[0] === 73 && bytes[1] === 73;
  if (!le && !(bytes[0] === 77 && bytes[1] === 77)) fail('文件头无效');
  const u16 = (p) => {
    range(p, 2);
    return v.getUint16(p, le);
  };
  const u32 = (p) => {
    range(p, 4);
    return v.getUint32(p, le);
  };
  if (u16(2) !== 42) fail('暂不支持 BigTIFF 或此文件版本');
  const ifd = u32(4),
    count = u16(ifd);
  range(ifd + 2, count * 12 + 4);
  if (u32(ifd + 2 + count * 12)) fail('暂不支持多页文件，请先导出单页');
  const wanted = new Set([
    256, 257, 258, 259, 262, 266, 273, 274, 277, 278, 279, 284, 317, 338, 339,
  ]);
  const tags = new Map();
  for (let i = 0; i < count; i++) {
    const p = ifd + 2 + i * 12,
      tag = u16(p);
    if (!wanted.has(tag)) continue;
    if (tags.has(tag)) fail('重复的图像字段');
    const type = u16(p + 2),
      n = u32(p + 4),
      size = type === 3 ? 2 : type === 4 ? 4 : 0;
    if (!size || n > 32e6) fail('图像字段格式暂不支持');
    const offset = n * size <= 4 ? p + 8 : u32(p + 8);
    range(offset, n * size);
    // Keep a view into the file rather than allocating potentially huge tag arrays.
    tags.set(tag, {
      n,
      at: (index) => (size === 2 ? u16(offset + index * size) : u32(offset + index * size)),
    });
  }
  const scalar = (tag, fallback) => {
    const field = tags.get(tag);
    if (!field) return fallback;
    if (field.n !== 1) fail('图像字段数量无效');
    return field.at(0);
  };
  const width = scalar(256, 0),
    height = scalar(257, 0);
  if (!width || !height || width * height > 32e6) fail('尺寸无效或超过 3200 万像素');
  if (scalar(266, 1) !== 1) fail('暂不支持反转位序');
  const photo = scalar(262, -1),
    samples = scalar(277, 1),
    compression = scalar(259, 1);
  if (![0, 1, 2].includes(photo)) fail('目前仅支持 RGB 和灰度图');
  const colors = photo === 2 ? 3 : 1;
  const extra = tags.get(338),
    alpha = extra?.n === 1 ? extra.at(0) : 0;
  if (samples !== colors && !(samples === colors + 1 && [1, 2].includes(alpha)))
    fail('颜色或透明度通道暂不支持');
  if (samples === colors && extra) fail('多余的透明度字段');
  const bits = tags.get(258),
    format = tags.get(339);
  if (!bits || bits.n !== samples) fail('仅支持每通道 8-bit 图像');
  for (let c = 0; c < samples; c++) if (bits.at(c) !== 8) fail('仅支持每通道 8-bit 图像');
  if (format && format.n !== samples) fail('像素格式字段数量无效');
  if (format)
    for (let c = 0; c < format.n; c++) if (format.at(c) !== 1) fail('暂不支持浮点或有符号像素');
  if (scalar(284, 1) !== 1) fail('暂不支持分平面存储');
  const predictor = scalar(317, 1);
  if (![1, 2].includes(predictor)) fail('暂不支持此预测编码');
  if (![1, 5, 32773].includes(compression)) fail('目前仅支持无压缩、LZW 或 PackBits 压缩');
  const rows = scalar(278, height),
    orientation = scalar(274, 1);
  if (!rows || orientation < 1 || orientation > 8) fail('条带或方向字段无效');
  const strips = Math.ceil(height / rows),
    offsets = tags.get(273),
    lengths = tags.get(279);
  if (!offsets || !lengths || offsets.n !== strips || lengths.n !== strips) fail('条带数量无效');
  const outWidth = orientation >= 5 ? height : width,
    outHeight = orientation >= 5 ? width : height;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let strip = 0; strip < strips; strip++) {
    const rowStart = strip * rows,
      rowCount = Math.min(rows, height - rowStart);
    const expected = rowCount * width * samples,
      offset = offsets.at(strip),
      length = lengths.at(strip);
    range(offset, length);
    let pixels = bytes.subarray(offset, offset + length);
    if (compression === 5) pixels = unpackLZW(pixels, expected, fail);
    else if (compression === 32773) pixels = unpack(pixels, expected, fail);
    else if (length < expected) fail('条带像素不足');
    if (predictor === 2) {
      if (compression === 1) pixels = pixels.slice(0, expected);
      const stride = width * samples;
      for (let row = 0; row < rowCount; row++)
        for (let p = row * stride + samples; p < (row + 1) * stride; p++)
          pixels[p] += pixels[p - samples];
    }
    for (let y = 0; y < rowCount; y++)
      for (let x = 0; x < width; x++) {
        const sy = rowStart + y,
          p = (y * width + x) * samples;
        let dx = x,
          dy = sy;
        if (orientation === 2) dx = width - 1 - x;
        if (orientation === 3) {
          dx = width - 1 - x;
          dy = height - 1 - sy;
        }
        if (orientation === 4) dy = height - 1 - sy;
        if (orientation === 5) {
          dx = sy;
          dy = x;
        }
        if (orientation === 6) {
          dx = height - 1 - sy;
          dy = x;
        }
        if (orientation === 7) {
          dx = height - 1 - sy;
          dy = width - 1 - x;
        }
        if (orientation === 8) {
          dx = sy;
          dy = width - 1 - x;
        }
        const dest = (dy * outWidth + dx) * 4,
          a = samples > colors ? pixels[p + colors] : 255;
        for (let c = 0; c < 3; c++) {
          let value = pixels[p + (colors === 3 ? c : 0)];
          if (photo === 0) value = 255 - value;
          data[dest + c] = alpha === 1 ? (a ? (value * 255) / a : 0) : value;
        }
        data[dest + 3] = a;
      }
  }
  return { width: outWidth, height: outHeight, data };
}
function unpack(source, size, fail) {
  const out = new Uint8Array(size);
  let p = 0,
    q = 0;
  while (q < size && p < source.length) {
    const control = source[p++];
    if (control === 128) continue;
    const count = control < 128 ? control + 1 : 257 - control;
    if (q + count > size) fail('PackBits 数据越界');
    if (control < 128) {
      if (p + count > source.length) fail('PackBits 数据不完整');
      out.set(source.subarray(p, p + count), q);
      p += count;
    } else {
      if (p >= source.length) fail('PackBits 数据不完整');
      out.fill(source[p++], q, q + count);
    }
    q += count;
  }
  if (q !== size) fail('PackBits 像素不足');
  return out;
}
