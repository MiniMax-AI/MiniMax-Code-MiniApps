// PNG 解码 / 编码（8bit、非隔行）、色彩统计、灰世界白平衡校正、预览缩图。
// 纯 Node 内置实现，不引入任何第三方依赖。
import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

export function readPngHeader(buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('not_png');
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') throw new Error('png_no_ihdr');
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
    colorType: buffer[25],
    interlace: buffer[28],
  };
}

// 调色板 PNG（colorType 3）在网上非常常见——新闻站、百科的插图大量是这种。
// 之前直接报 png_color_type_unsupported，结果是参考图下载成功、却拼不进对比图，
// 判定节点只能"取第一张可用图"，等于 silently 放弃了这张图。
const PALETTE_DEPTHS = new Set([1, 2, 4, 8]);

export function decodePng(buffer) {
  const header = readPngHeader(buffer);
  if (header.interlace !== 0) throw new Error('png_interlaced_unsupported');
  const palette = header.colorType === 3;
  if (palette) {
    if (!PALETTE_DEPTHS.has(header.bitDepth)) throw new Error('png_bit_depth_unsupported');
  } else if (header.bitDepth !== 8) {
    throw new Error('png_bit_depth_unsupported');
  }
  const channels = palette ? 1 : CHANNELS[header.colorType];
  if (!channels) throw new Error('png_color_type_unsupported');

  let plte = null;
  let trns = null;
  const chunks = [];
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    if (type === 'IDAT') chunks.push(buffer.subarray(start, start + length));
    else if (type === 'PLTE') plte = buffer.subarray(start, start + length);
    else if (type === 'tRNS') trns = buffer.subarray(start, start + length);
    if (type === 'IEND') break;
    offset = start + length + 4;
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks));
  const { width, height } = header;
  // 过滤永远按字节做：调色板图每个像素不足 1 字节，一行是 ceil(width*bitDepth/8) 字节。
  const unit = palette ? 1 : channels;
  const stride = palette ? Math.ceil((width * header.bitDepth) / 8) : width * channels;
  const out = Buffer.alloc(stride * height);

  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const rawByte = line[x];
      const a = x >= unit ? cur[x - unit] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= unit ? prev[x - unit] : 0;
      let value;
      if (filter === 0) value = rawByte;
      else if (filter === 1) value = rawByte + a;
      else if (filter === 2) value = rawByte + b;
      else if (filter === 3) value = rawByte + ((a + b) >> 1);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value = rawByte + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error('png_filter_unsupported');
      cur[x] = value & 0xff;
    }
  }

  if (!palette) return { width, height, channels, data: out };
  if (!plte) throw new Error('png_palette_missing');

  const withAlpha = Boolean(trns && trns.length);
  const outChannels = withAlpha ? 4 : 3;
  const rgb = Buffer.alloc(width * height * outChannels);
  const mask = (1 << header.bitDepth) - 1;
  const perByte = 8 / header.bitDepth;
  for (let y = 0; y < height; y += 1) {
    const row = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < width; x += 1) {
      let index;
      if (header.bitDepth === 8) index = row[x];
      else {
        const byte = row[Math.floor(x / perByte)] || 0;
        const shift = 8 - header.bitDepth * ((x % perByte) + 1);
        index = (byte >> shift) & mask;
      }
      const p = index * 3;
      const o = (y * width + x) * outChannels;
      rgb[o] = plte[p] || 0;
      rgb[o + 1] = plte[p + 1] || 0;
      rgb[o + 2] = plte[p + 2] || 0;
      if (withAlpha) rgb[o + 3] = index < trns.length ? trns[index] : 255;
    }
  }
  return { width, height, channels: outChannels, data: rgb };
}

// 画布合成：用于把多张看图材料拼成一张 contact sheet，评审一次 read 就能看全。
export function createCanvas(width, height, channels) {
  const ch = channels || 3;
  return { width, height, channels: ch, data: Buffer.alloc(width * height * ch) };
}

export function drawImage(canvas, src, dx, dy, dw, dh) {
  const targetW = Math.max(1, Math.round(dw));
  const targetH = Math.max(1, Math.round(dh));
  for (let y = 0; y < targetH; y += 1) {
    const cy = dy + y;
    if (cy < 0 || cy >= canvas.height) continue;
    const sy = Math.min(src.height - 1, Math.floor((y / targetH) * src.height));
    for (let x = 0; x < targetW; x += 1) {
      const cx = dx + x;
      if (cx < 0 || cx >= canvas.width) continue;
      const sx = Math.min(src.width - 1, Math.floor((x / targetW) * src.width));
      const si = (sy * src.width + sx) * src.channels;
      const di = (cy * canvas.width + cx) * canvas.channels;
      for (let c = 0; c < canvas.channels; c += 1) {
        canvas.data[di + c] = src.channels === 1 ? src.data[si] : src.data[si + Math.min(c, src.channels - 1)];
      }
    }
  }
  return canvas;
}

// gamma 提亮：把暗部拉起来，用于核对暗区里有没有文字/水印/多余物体。
export function adjustGamma(image, gamma) {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) lut[i] = Math.round(255 * Math.pow(i / 255, gamma));
  const out = Buffer.from(image.data);
  const channels = image.channels;
  const limit = channels >= 3 ? 3 : 1;
  for (let i = 0; i < out.length; i += channels) {
    for (let c = 0; c < limit; c += 1) out[i + c] = lut[out[i + c]];
  }
  return { width: image.width, height: image.height, channels, data: out };
}

export function encodePng(image, options) {
  const { width, height, channels, data } = image;
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 1 ? 0 : channels === 2 ? 4 : channels === 3 ? 2 : 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: (options && options.level) || 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

let crcTable = null;
function crc32(buffer) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) crc = crcTable[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

// 色彩统计：通道均值、红/蓝相对增益、锐度代理（平均梯度能量）。
export function analyze(image) {
  const { width, height, channels, data } = image;
  const step = Math.max(1, Math.floor((width * height) / 400000));
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;
  let clipped = 0;
  for (let p = 0; p < width * height; p += step) {
    const i = p * channels;
    if (channels === 1) {
      sumR += data[i];
      sumG += data[i];
      sumB += data[i];
    } else if (channels === 2) {
      sumR += data[i];
      sumG += data[i];
      sumB += data[i];
    } else {
      sumR += data[i];
      sumG += data[i + 1];
      sumB += data[i + 2];
    }
    if (data[i] > 250 || data[i + Math.min(1, channels - 1)] > 250) clipped += 1;
    count += 1;
  }
  const meanR = sumR / count;
  const meanG = sumG / count;
  const meanB = sumB / count;
  const avg = (meanR + meanG + meanB) / 3;
  const luma = 0.2126 * meanR + 0.7152 * meanG + 0.0722 * meanB;
  const redGain = meanR / Math.max(1, (meanG + meanB) / 2);
  const blueGain = meanB / Math.max(1, (meanR + meanG) / 2);

  let gradient = 0;
  let gcount = 0;
  const gstep = Math.max(1, Math.floor(Math.min(width, height) / 600));
  for (let y = gstep; y < height - gstep; y += gstep) {
    for (let x = gstep; x < width - gstep; x += gstep) {
      const i = (y * width + x) * channels;
      const right = (y * width + x + 1) * channels;
      const down = ((y + 1) * width + x) * channels;
      gradient += Math.abs(data[i] - data[right]) + Math.abs(data[i] - data[down]);
      gcount += 1;
    }
  }
  return {
    meanR: round(meanR),
    meanG: round(meanG),
    meanB: round(meanB),
    luma: round(luma),
    redGain: round(redGain, 4),
    blueGain: round(blueGain, 4),
    clippedRatio: round(clipped / count, 4),
    sharpness: round(gcount ? gradient / gcount : 0, 3),
    balance: round(avg, 2),
  };
}

// 偏色判定：红增益显著高于 1 视为发红；蓝增益显著高于 1 视为发冷。
export function detectCast(stats, options) {
  const redLimit = (options && options.redLimit) || 1.06;
  const blueLimit = (options && options.blueLimit) || 1.08;
  if (stats.redGain >= redLimit) {
    return { cast: 'red', strength: round(stats.redGain - 1, 4), label: '整体偏红' };
  }
  if (stats.blueGain >= blueLimit) {
    return { cast: 'blue', strength: round(stats.blueGain - 1, 4), label: '整体偏冷' };
  }
  return { cast: 'none', strength: 0, label: '无明显偏色' };
}

// 灰世界白平衡：把三通道均值拉回同一水平，强度可调，单次确定性校正。
export function whiteBalance(image, strength) {
  const stats = analyze(image);
  const target = (stats.meanR + stats.meanG + stats.meanB) / 3;
  const factor = strength === undefined ? 0.85 : strength;
  const gains = [target / Math.max(1, stats.meanR), target / Math.max(1, stats.meanG), target / Math.max(1, stats.meanB)].map(
    (g) => clamp(1 + (g - 1) * factor, 0.78, 1.28),
  );
  const { channels, data } = image;
  const out = Buffer.from(data);
  if (channels >= 3) {
    for (let i = 0; i < out.length; i += channels) {
      out[i] = clamp(out[i] * gains[0], 0, 255);
      out[i + 1] = clamp(out[i + 1] * gains[1], 0, 255);
      out[i + 2] = clamp(out[i + 2] * gains[2], 0, 255);
    }
  }
  return { image: { width: image.width, height: image.height, channels, data: out }, gains: gains.map((g) => round(g, 4)), before: stats };
}

// 按目标统计配平：用于把编辑后漂移的色彩拉回父图/参考图的平衡，而不是一律拉回灰色。
// 这样刻意暖调的原图不会被误校正。
export function matchBalance(image, target, strength) {
  const stats = analyze(image);
  const factor = strength === undefined ? 0.9 : strength;
  const gains = [
    target.meanR / Math.max(1, stats.meanR),
    target.meanG / Math.max(1, stats.meanG),
    target.meanB / Math.max(1, stats.meanB),
  ].map((g) => clamp(1 + (g - 1) * factor, 0.75, 1.35));
  const { channels, data } = image;
  const out = Buffer.from(data);
  if (channels >= 3) {
    for (let i = 0; i < out.length; i += channels) {
      out[i] = clamp(out[i] * gains[0], 0, 255);
      out[i + 1] = clamp(out[i + 1] * gains[1], 0, 255);
      out[i + 2] = clamp(out[i + 2] * gains[2], 0, 255);
    }
  }
  return { image: { width: image.width, height: image.height, channels, data: out }, gains: gains.map((g) => round(g, 4)), before: stats };
}

// 相对父图的偏色漂移：只有编辑把画面推红了才判定为“发红”。
export function detectDrift(stats, parentStats, options) {
  const limit = (options && options.limit) || 0.05;
  if (!parentStats) {
    const abs = detectCast(stats, { redLimit: (options && options.absoluteRed) || 1.15 });
    return abs.cast === 'none' ? { cast: 'none', strength: 0, label: '色彩正常', mode: 'absolute' } : { ...abs, mode: 'absolute' };
  }
  const redDrift = stats.redGain - parentStats.redGain;
  const blueDrift = stats.blueGain - parentStats.blueGain;
  if (redDrift >= limit) {
    return { cast: 'red', strength: round(redDrift, 4), label: '相对父图发红', mode: 'relative' };
  }
  if (blueDrift >= limit) {
    return { cast: 'blue', strength: round(blueDrift, 4), label: '相对父图偏冷', mode: 'relative' };
  }
  return { cast: 'none', strength: 0, label: '色彩正常', mode: 'relative' };
}

// 锐度漂移：全图 edit 累积的过度锐化。
export function detectOverSharpen(stats, parentStats, options) {
  const limit = (options && options.limit) || 0.25;
  if (!parentStats || !parentStats.sharpness) return { overSharpened: false, ratio: 1 };
  const ratio = stats.sharpness / parentStats.sharpness;
  return { overSharpened: ratio >= 1 + limit, ratio: round(ratio, 3) };
}

export function downsample(image, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
  if (scale >= 1) return image;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const { channels } = image;
  const out = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(image.height - 1, Math.floor((y / height) * image.height));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(image.width - 1, Math.floor((x / width) * image.width));
      const si = (sy * image.width + sx) * channels;
      const di = (y * width + x) * channels;
      for (let c = 0; c < channels; c += 1) out[di + c] = image.data[si + c];
    }
  }
  return { width, height, channels, data: out };
}

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}
function round(value, digits) {
  const p = Math.pow(10, digits === undefined ? 2 : digits);
  return Math.round(value * p) / p;
}
