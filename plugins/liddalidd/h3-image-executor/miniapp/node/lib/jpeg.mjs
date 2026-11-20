// 纯 Node 实现的 JPEG 解码器：Huffman 编码的 baseline / extended（SOF0、SOF1）和 progressive（SOF2）。
// 存在的理由：参考图（真人照片、车型图、用户上传图）绝大多数是 JPEG，
// 没有它评审就看不到参考图，一致性判断只能靠猜。
// 支持 8bit、1 或 3 分量（YCbCr，或 Adobe / 分量 ID 标明的 RGB）、任意抽样比、restart interval、
// 交织与非交织扫描。
// 不支持：算术编码（SOF9–SOF15）、无损（SOF3）、分层（SOF5–SOF7）、12bit、CMYK / YCCK（4 分量）。
// 这些在网上的图片里很少见；调用方应先用 jpegUnsupportedReason 把它们如实拒掉，而不是解到一半才失败。
//
// 渐进式为什么必须支持：网上相当一部分照片是渐进式 JPEG（图库、新闻站、CDN 压缩过的图）。
// 以前解不开它们，参考图检索拿回来的候选在拼判定图时被悄悄跳过，判定节点根本看不到，
// 时间线上却照样标「不符合要求」（真机 20261112-8a442a：吉祥物 9 张候选判定节点只看到 2 张，
// 白底官方全身插画就是渐进式 JPEG）。

const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];

const COS = (() => {
  const table = new Float32Array(64);
  for (let u = 0; u < 8; u += 1) {
    const cu = (u === 0 ? Math.SQRT1_2 : 1) * 0.5;
    for (let x = 0; x < 8; x += 1) {
      table[u * 8 + x] = cu * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
    }
  }
  return table;
})();

// IDCT 的临时缓冲。单线程，复用一份即可，省掉每个块一次分配。
const IDCT_TMP = new Float32Array(64);

export function isJpeg(buffer) {
  return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function isSofMarker(marker) {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

// 只读帧头（不解码）：编码方式、位深、尺寸、分量数。读不到返回 null。
export function readJpegFrame(buffer) {
  if (!isJpeg(buffer)) return null;
  let offset = 2;
  while (offset < buffer.length - 9) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    if (isSofMarker(marker)) {
      return {
        sof: marker - 0xc0,
        precision: buffer[offset + 4],
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
        components: buffer[offset + 9],
      };
    }
    offset += 2 + buffer.readUInt16BE(offset + 2);
  }
  return null;
}

// 解不了的原因（中文，给时间线看）；能解返回空字符串。只看帧头，不做实际解码。
export function jpegUnsupportedReason(buffer) {
  const frame = readJpegFrame(buffer);
  if (!frame) return 'JPEG 头损坏';
  if (frame.sof === 3 || frame.sof === 7 || frame.sof === 11 || frame.sof === 15) return '无损 JPEG 不支持';
  if (frame.sof >= 9) return '算术编码 JPEG 不支持';
  if (frame.sof >= 5) return '分层 JPEG 不支持';
  if (frame.precision !== 8) return frame.precision + 'bit JPEG 不支持';
  if (frame.components === 4) return 'CMYK JPEG 不支持';
  if (frame.components !== 1 && frame.components !== 3) return frame.components + ' 分量 JPEG 不支持';
  if (!frame.width || !frame.height) return 'JPEG 尺寸缺失';
  return '';
}

export function decodeJpeg(buffer) {
  const quantTables = [];
  const huffDC = [];
  const huffAC = [];
  let frame = null;
  let restartInterval = 0;
  let adobeTransform = -1;
  let scans = 0;
  let offset = 2;

  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    // 0xFF 填充字节：只跳一个，下一个 0xFF 才是真正的标记前缀。
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    offset += 2;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9) break;
    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    const segment = buffer.subarray(offset + 2, offset + length);

    if (marker === 0xdb) {
      let p = 0;
      while (p < segment.length) {
        const precision = segment[p] >> 4;
        const id = segment[p] & 15;
        p += 1;
        const table = new Int32Array(64);
        for (let i = 0; i < 64; i += 1) {
          const z = ZIGZAG[i];
          table[z] = precision ? segment.readUInt16BE(p + i * 2) : segment[p + i];
        }
        p += precision ? 128 : 64;
        quantTables[id] = table;
      }
    } else if (marker === 0xc4) {
      let p = 0;
      while (p < segment.length) {
        const tableClass = segment[p] >> 4;
        const id = segment[p] & 15;
        p += 1;
        const counts = new Uint8Array(16);
        let total = 0;
        for (let i = 0; i < 16; i += 1) {
          counts[i] = segment[p + i];
          total += counts[i];
        }
        p += 16;
        const values = new Uint8Array(total);
        for (let i = 0; i < total; i += 1) values[i] = segment[p + i];
        p += total;
        const table = buildHuffman(counts, values);
        if (tableClass === 0) huffDC[id] = table;
        else huffAC[id] = table;
      }
    } else if (marker === 0xdd) {
      restartInterval = segment.readUInt16BE(0);
    } else if (marker === 0xee) {
      // Adobe APP14：transform 0 表示 3 分量存的是 RGB 而不是 YCbCr。
      if (segment.length >= 12 && segment.subarray(0, 5).toString('latin1') === 'Adobe') adobeTransform = segment[11];
    } else if (isSofMarker(marker)) {
      frame = readFrame(marker, segment);
    } else if (marker === 0xda) {
      if (!frame) throw new Error('jpeg_no_frame');
      const scan = readScan(segment, frame);
      const dataStart = offset + length;
      // 快速路径：顺序编码、第一段扫描就包含全部分量（绝大多数 baseline 图都是这样，也是唯一一段扫描）。
      // 直接解成像素，不留系数，内存和以前一样。单分量帧只有在抽样因子是 1x1 时才能走这条路：
      // 单分量扫描按分量自己的块网格排列，不按 MCU。
      if (!frame.progressive && scans === 0 && scan.components.length === frame.components.length &&
        (scan.components.length > 1 || (frame.components[0].h === 1 && frame.components[0].v === 1))) {
        latchQuant(frame, scan, quantTables);
        attachTables(scan, huffDC, huffAC, false);
        decodeInterleavedToPixels(buffer, dataStart, frame, scan, restartInterval);
        return finishFrame(frame, rgbFrame(frame, adobeTransform));
      }
      latchQuant(frame, scan, quantTables);
      attachTables(scan, huffDC, huffAC, frame.progressive);
      ensureCoefficients(frame);
      const end = decodeScanToCoefficients(buffer, dataStart, frame, scan, restartInterval);
      scans += 1;
      offset = nextMarker(buffer, end);
      continue;
    }
    offset += length;
  }
  if (!frame) throw new Error('jpeg_no_frame');
  if (!scans) throw new Error('jpeg_no_scan');
  coefficientsToPixels(frame);
  return finishFrame(frame, rgbFrame(frame, adobeTransform));
}

function readFrame(marker, segment) {
  if (marker !== 0xc0 && marker !== 0xc1 && marker !== 0xc2) throw new Error('jpeg_unsupported_sof' + (marker - 0xc0));
  const precision = segment[0];
  if (precision !== 8) throw new Error('jpeg_unsupported_precision_' + precision);
  const height = segment.readUInt16BE(1);
  const width = segment.readUInt16BE(3);
  const count = segment[5];
  if (count === 4) throw new Error('jpeg_cmyk_unsupported');
  if (count !== 1 && count !== 3) throw new Error('jpeg_unsupported_components_' + count);
  if (!width || !height) throw new Error('jpeg_bad_size');
  const components = [];
  for (let i = 0; i < count; i += 1) {
    const base = 6 + i * 3;
    components.push({
      id: segment[base],
      h: segment[base + 1] >> 4 || 1,
      v: segment[base + 1] & 15 || 1,
      quantId: segment[base + 2],
    });
  }
  const hmax = Math.max(...components.map((c) => c.h));
  const vmax = Math.max(...components.map((c) => c.v));
  const mcusPerLine = Math.ceil(width / (8 * hmax));
  const mcusPerColumn = Math.ceil(height / (8 * vmax));
  for (const c of components) {
    // 分量自己的采样尺寸和块网格（非交织扫描按它排列）；存储按 MCU 补齐（交织扫描会覆盖补齐的块）。
    c.sampleWidth = Math.ceil((width * c.h) / hmax);
    c.sampleHeight = Math.ceil((height * c.v) / vmax);
    c.blocksPerLine = Math.ceil(c.sampleWidth / 8);
    c.blocksPerColumn = Math.ceil(c.sampleHeight / 8);
    c.strideBlocks = mcusPerLine * c.h;
    c.rowBlocks = mcusPerColumn * c.v;
    c.pred = 0;
    c.quant = null;
  }
  return { width, height, components, hmax, vmax, mcusPerLine, mcusPerColumn, progressive: marker === 0xc2 };
}

function readScan(segment, frame) {
  const count = segment[0];
  const components = [];
  for (let i = 0; i < count; i += 1) {
    const id = segment[1 + i * 2];
    const tables = segment[2 + i * 2];
    const component = frame.components.find((item) => item.id === id);
    if (!component) throw new Error('jpeg_bad_scan_component');
    components.push({ component, dcId: tables >> 4, acId: tables & 15 });
  }
  const p = 1 + count * 2;
  return {
    components,
    ss: segment[p],
    se: segment[p + 1],
    ah: segment[p + 2] >> 4,
    al: segment[p + 2] & 15,
  };
}

// 量化表在分量第一次出现的扫描时锁定（libjpeg 同样处理），之后再出现的 DQT 不影响它。
function latchQuant(frame, scan, quantTables) {
  for (const { component } of scan.components) {
    if (component.quant) continue;
    const table = quantTables[component.quantId];
    component.quant = table ? Int32Array.from(table) : new Int32Array(64).fill(1);
  }
}

function attachTables(scan, huffDC, huffAC, progressive) {
  for (const entry of scan.components) {
    entry.dc = huffDC[entry.dcId];
    entry.ac = huffAC[entry.acId];
    // 渐进式：DC 扫描只用 DC 表，AC 扫描只用 AC 表，DC 细化扫描两张都不用。
    const needDc = !progressive || (scan.ss === 0 && scan.ah === 0);
    const needAc = !progressive || scan.ss > 0;
    if ((needDc && !entry.dc) || (needAc && !entry.ac)) throw new Error('jpeg_missing_huffman');
  }
}

function ensureCoefficients(frame) {
  for (const c of frame.components) {
    if (!c.coefficients) c.coefficients = new Int16Array(c.strideBlocks * c.rowBlocks * 64);
  }
}

function buildHuffman(counts, values) {
  const mincode = new Int32Array(17);
  const maxcode = new Int32Array(18).fill(-1);
  const valptr = new Int32Array(17);
  let code = 0;
  let k = 0;
  for (let length = 1; length <= 16; length += 1) {
    valptr[length] = k;
    mincode[length] = code;
    code += counts[length - 1];
    k += counts[length - 1];
    maxcode[length] = counts[length - 1] ? code - 1 : -1;
    code <<= 1;
  }
  maxcode[17] = 0x7fffffff;
  return { mincode, maxcode, valptr, values };
}

// ---------------------------------------------------------------- 快速路径：顺序编码、单段交织扫描

function decodeInterleavedToPixels(buffer, start, frame, scan, restartInterval) {
  const { mcusPerLine, mcusPerColumn } = frame;
  for (const c of frame.components) {
    c.pixels = new Uint8Array(c.strideBlocks * 8 * c.rowBlocks * 8);
    c.pred = 0;
  }
  const reader = new BitReader(buffer, start);
  const block = new Int32Array(64);
  const pixels = new Uint8Array(64);
  let mcu = 0;
  for (let mcuRow = 0; mcuRow < mcusPerColumn; mcuRow += 1) {
    for (let mcuCol = 0; mcuCol < mcusPerLine; mcuCol += 1) {
      if (restartInterval && mcu && mcu % restartInterval === 0) {
        reader.restart();
        for (const c of frame.components) c.pred = 0;
      }
      mcu += 1;
      for (const entry of scan.components) {
        const c = entry.component;
        for (let v = 0; v < c.v; v += 1) {
          for (let h = 0; h < c.h; h += 1) {
            const row = mcuRow * c.v + v;
            const col = mcuCol * c.h + h;
            decodeBlockDequantized(reader, entry, block);
            idct(block, pixels);
            const stride = c.strideBlocks * 8;
            for (let y = 0; y < 8; y += 1) {
              const target = (row * 8 + y) * stride + col * 8;
              for (let x = 0; x < 8; x += 1) c.pixels[target + x] = pixels[y * 8 + x];
            }
          }
        }
      }
    }
  }
}

function decodeBlockDequantized(reader, entry, block) {
  const c = entry.component;
  block.fill(0);
  const t = decodeHuffman(reader, entry.dc);
  const diff = t ? extend(reader.receive(t), t) : 0;
  c.pred += diff;
  block[0] = c.pred * c.quant[0];
  let k = 1;
  while (k < 64) {
    const rs = decodeHuffman(reader, entry.ac);
    const size = rs & 15;
    const run = rs >> 4;
    if (size === 0) {
      if (run < 15) break;
      k += 16;
      continue;
    }
    k += run;
    if (k > 63) break;
    const z = ZIGZAG[k];
    block[z] = extend(reader.receive(size), size) * c.quant[z];
    k += 1;
  }
}

// ---------------------------------------------------------------- 系数路径：渐进式、非交织扫描
//
// 每段扫描只贡献一部分系数（某几个频率、某几位精度），全部扫描读完才能做 IDCT。
// 系数按块存成 Int16（未反量化，自然顺序），全部扫描结束后统一反量化 + IDCT。
// 渐进式解码的四种扫描（DC 首次 / DC 细化 / AC 首次 / AC 细化）按 ITU-T T.81 附录 G 实现，
// AC 细化与 libjpeg 的 decode_mcu_AC_refine 逐步对应。

function decodeScanToCoefficients(buffer, start, frame, scan, restartInterval) {
  const reader = new BitReader(buffer, start);
  const state = { eobrun: 0 };
  const { ss, se, ah, al } = scan;
  let decode;
  if (!frame.progressive) decode = decodeSequential;
  else if (ss === 0) decode = ah === 0 ? decodeDcFirst : decodeDcRefine;
  else decode = ah === 0 ? decodeAcFirst : decodeAcRefine;
  for (const entry of scan.components) entry.component.pred = 0;

  const single = scan.components.length === 1;
  const units = single
    ? scan.components[0].component.blocksPerLine * scan.components[0].component.blocksPerColumn
    : frame.mcusPerLine * frame.mcusPerColumn;
  for (let n = 0; n < units; n += 1) {
    if (restartInterval && n && n % restartInterval === 0) {
      reader.restart();
      for (const entry of scan.components) entry.component.pred = 0;
      state.eobrun = 0;
    }
    if (single) {
      const entry = scan.components[0];
      const c = entry.component;
      const row = Math.floor(n / c.blocksPerLine);
      const col = n % c.blocksPerLine;
      decode(reader, entry, (row * c.strideBlocks + col) * 64, state, ss, se, al);
      continue;
    }
    const mcuRow = Math.floor(n / frame.mcusPerLine);
    const mcuCol = n % frame.mcusPerLine;
    for (const entry of scan.components) {
      const c = entry.component;
      for (let v = 0; v < c.v; v += 1) {
        for (let h = 0; h < c.h; h += 1) {
          const row = mcuRow * c.v + v;
          const col = mcuCol * c.h + h;
          decode(reader, entry, (row * c.strideBlocks + col) * 64, state, ss, se, al);
        }
      }
    }
  }
  return reader.pos;
}

function decodeSequential(reader, entry, offset) {
  const c = entry.component;
  const coef = c.coefficients;
  const t = decodeHuffman(reader, entry.dc);
  const diff = t ? extend(reader.receive(t), t) : 0;
  c.pred += diff;
  coef[offset] = c.pred;
  let k = 1;
  while (k < 64) {
    const rs = decodeHuffman(reader, entry.ac);
    const size = rs & 15;
    const run = rs >> 4;
    if (size === 0) {
      if (run < 15) break;
      k += 16;
      continue;
    }
    k += run;
    if (k > 63) break;
    coef[offset + ZIGZAG[k]] = extend(reader.receive(size), size);
    k += 1;
  }
}

function decodeDcFirst(reader, entry, offset, state, ss, se, al) {
  const c = entry.component;
  const t = decodeHuffman(reader, entry.dc);
  const diff = t ? extend(reader.receive(t), t) : 0;
  c.pred += diff;
  c.coefficients[offset] = c.pred * (1 << al);
}

function decodeDcRefine(reader, entry, offset, state, ss, se, al) {
  if (reader.bit()) entry.component.coefficients[offset] |= 1 << al;
}

function decodeAcFirst(reader, entry, offset, state, ss, se, al) {
  if (state.eobrun > 0) {
    state.eobrun -= 1;
    return;
  }
  const coef = entry.component.coefficients;
  let k = ss;
  while (k <= se) {
    const rs = decodeHuffman(reader, entry.ac);
    const size = rs & 15;
    const run = rs >> 4;
    if (size === 0) {
      if (run < 15) {
        state.eobrun = (1 << run) - 1;
        if (run) state.eobrun += reader.receive(run);
        break;
      }
      k += 16;
      continue;
    }
    k += run;
    if (k > 63) break;
    coef[offset + ZIGZAG[k]] = extend(reader.receive(size), size) * (1 << al);
    k += 1;
  }
}

function decodeAcRefine(reader, entry, offset, state, ss, se, al) {
  const coef = entry.component.coefficients;
  const p1 = 1 << al;
  const m1 = -1 << al;
  let k = ss;
  if (state.eobrun <= 0) {
    for (; k <= se; k += 1) {
      const rs = decodeHuffman(reader, entry.ac);
      let run = rs >> 4;
      let value = rs & 15;
      if (value) {
        // 细化扫描里新出现的系数只可能是 ±1（乘上本段的位权）。
        value = reader.bit() ? p1 : m1;
      } else if (run !== 15) {
        state.eobrun = 1 << run;
        if (run) state.eobrun += reader.receive(run);
        break;
      }
      // 越过已经非零的系数（给它们补一位精度）和 run 个仍为零的系数。
      do {
        const z = offset + ZIGZAG[k];
        if (coef[z] !== 0) {
          if (reader.bit() && (coef[z] & p1) === 0) coef[z] += coef[z] >= 0 ? p1 : m1;
        } else {
          run -= 1;
          if (run < 0) break;
        }
        k += 1;
      } while (k <= se);
      if (value && k <= se) coef[offset + ZIGZAG[k]] = value;
    }
  }
  if (state.eobrun > 0) {
    // EOB 区段里的块：只给已经非零的系数补位。
    for (; k <= se; k += 1) {
      const z = offset + ZIGZAG[k];
      if (coef[z] !== 0 && reader.bit() && (coef[z] & p1) === 0) coef[z] += coef[z] >= 0 ? p1 : m1;
    }
    state.eobrun -= 1;
  }
}

function coefficientsToPixels(frame) {
  const block = new Int32Array(64);
  const pixels = new Uint8Array(64);
  for (const c of frame.components) {
    const coef = c.coefficients || new Int16Array(c.strideBlocks * c.rowBlocks * 64);
    const quant = c.quant || new Int32Array(64).fill(1);
    const stride = c.strideBlocks * 8;
    c.pixels = new Uint8Array(stride * c.rowBlocks * 8);
    for (let row = 0; row < c.rowBlocks; row += 1) {
      for (let col = 0; col < c.strideBlocks; col += 1) {
        const offset = (row * c.strideBlocks + col) * 64;
        for (let i = 0; i < 64; i += 1) block[i] = coef[offset + i] * quant[i];
        idct(block, pixels);
        for (let y = 0; y < 8; y += 1) {
          const target = (row * 8 + y) * stride + col * 8;
          for (let x = 0; x < 8; x += 1) c.pixels[target + x] = pixels[y * 8 + x];
        }
      }
    }
    c.coefficients = null;
  }
}

// 扫描数据结束后找下一个标记：跳过字节填充（FF 00）、RST 标记和填充用的 FF。
function nextMarker(buffer, from) {
  let p = Math.max(0, from);
  while (p < buffer.length - 1) {
    if (buffer[p] === 0xff) {
      const next = buffer[p + 1];
      if (next !== 0x00 && next !== 0xff && !(next >= 0xd0 && next <= 0xd7)) return p;
    }
    p += 1;
  }
  return buffer.length;
}

// ---------------------------------------------------------------- 输出

// 3 分量什么时候按 RGB 处理：Adobe APP14 写明 transform=0，或者分量 ID 就是 'R' 'G' 'B'。
function rgbFrame(frame, adobeTransform) {
  if (frame.components.length !== 3) return false;
  if (adobeTransform === 0) return true;
  const ids = frame.components.map((c) => c.id);
  return ids[0] === 0x52 && ids[1] === 0x47 && ids[2] === 0x42;
}

function finishFrame(frame, isRgb) {
  const { width, height, components, hmax, vmax } = frame;
  const planes = components.map((component) => upsample(component, width, height, hmax, vmax));
  const out = Buffer.alloc(width * height * 3);
  if (components.length === 1) {
    for (let p = 0; p < width * height; p += 1) {
      const value = planes[0][p];
      out[p * 3] = value;
      out[p * 3 + 1] = value;
      out[p * 3 + 2] = value;
    }
    return { width, height, channels: 3, data: out };
  }
  const [A, B, C] = planes;
  if (isRgb) {
    for (let p = 0; p < width * height; p += 1) {
      out[p * 3] = A[p];
      out[p * 3 + 1] = B[p];
      out[p * 3 + 2] = C[p];
    }
    return { width, height, channels: 3, data: out };
  }
  for (let p = 0; p < width * height; p += 1) {
    const y = A[p];
    const cb = B[p] - 128;
    const cr = C[p] - 128;
    const di = p * 3;
    out[di] = clamp(y + 1.402 * cr);
    out[di + 1] = clamp(y - 0.344136 * cb - 0.714136 * cr);
    out[di + 2] = clamp(y + 1.772 * cb);
  }
  return { width, height, channels: 3, data: out };
}

// 把某个分量的块平面上采样到整图分辨率。
// 采样中心映射 src = (dst + 0.5) * (h / hmax) - 0.5，与 libjpeg 的 fancy（三角 3:1）上采样等价。
// 取样只到分量的实际采样范围为止：按 MCU 补齐出来的块在非交织扫描里没有编码，不能拿来插值。
function upsample(component, width, height, hmax, vmax) {
  const stride = component.strideBlocks * 8;
  const src = component.pixels;
  const out = new Uint8Array(width * height);
  const maxX = Math.min(stride, component.sampleWidth) - 1;
  const maxY = Math.min(component.rowBlocks * 8, component.sampleHeight) - 1;
  const rx = component.h / hmax;
  const ry = component.v / vmax;
  if (rx === 1 && ry === 1) {
    for (let y = 0; y < height; y += 1) {
      const row = Math.min(maxY, y) * stride;
      for (let x = 0; x < width; x += 1) out[y * width + x] = src[row + Math.min(maxX, x)];
    }
    return out;
  }
  for (let y = 0; y < height; y += 1) {
    const fy = (y + 0.5) * ry - 0.5;
    const y0 = Math.floor(fy);
    const wy = fy - y0;
    const ya = Math.min(maxY, Math.max(0, y0)) * stride;
    const yb = Math.min(maxY, Math.max(0, y0 + 1)) * stride;
    for (let x = 0; x < width; x += 1) {
      const fx = (x + 0.5) * rx - 0.5;
      const x0 = Math.floor(fx);
      const wx = fx - x0;
      const xa = Math.min(maxX, Math.max(0, x0));
      const xb = Math.min(maxX, Math.max(0, x0 + 1));
      const top = src[ya + xa] + (src[ya + xb] - src[ya + xa]) * wx;
      const bottom = src[yb + xa] + (src[yb + xb] - src[yb + xa]) * wx;
      out[y * width + x] = Math.round(top + (bottom - top) * wy);
    }
  }
  return out;
}

// ---------------------------------------------------------------- 熵解码基础

class BitReader {
  constructor(data, pos) {
    this.data = data;
    this.pos = pos;
    this.buf = 0;
    this.count = 0;
  }

  bit() {
    if (this.count === 0) {
      if (this.pos >= this.data.length) return 0;
      const byte = this.data[this.pos];
      this.pos += 1;
      if (byte === 0xff) {
        const next = this.data[this.pos];
        if (next === 0x00) this.pos += 1;
        else {
          // 碰到标记：停在标记前，之后的读取都补 0。
          this.pos -= 1;
          return 0;
        }
      }
      this.buf = byte;
      this.count = 8;
    }
    this.count -= 1;
    return (this.buf >> this.count) & 1;
  }

  receive(length) {
    let value = 0;
    for (let i = 0; i < length; i += 1) value = (value << 1) | this.bit();
    return value;
  }

  restart() {
    this.count = 0;
    while (this.pos < this.data.length - 1) {
      if (this.data[this.pos] === 0xff && this.data[this.pos + 1] >= 0xd0 && this.data[this.pos + 1] <= 0xd7) {
        this.pos += 2;
        return;
      }
      this.pos += 1;
    }
  }
}

function decodeHuffman(reader, table) {
  let code = reader.bit();
  let length = 1;
  while (length <= 16) {
    if (table.maxcode[length] >= 0 && code <= table.maxcode[length]) {
      return table.values[table.valptr[length] + code - table.mincode[length]];
    }
    code = (code << 1) | reader.bit();
    length += 1;
  }
  return 0;
}

function extend(value, length) {
  return value < 1 << (length - 1) ? value - (1 << length) + 1 : value;
}

function idct(block, out) {
  const tmp = IDCT_TMP;
  for (let u = 0; u < 8; u += 1) {
    for (let x = 0; x < 8; x += 1) {
      let sum = 0;
      for (let v = 0; v < 8; v += 1) sum += block[u * 8 + v] * COS[v * 8 + x];
      tmp[u * 8 + x] = sum;
    }
  }
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      let sum = 0;
      for (let u = 0; u < 8; u += 1) sum += tmp[u * 8 + x] * COS[u * 8 + y];
      const value = Math.round(sum) + 128;
      out[y * 8 + x] = value < 0 ? 0 : value > 255 ? 255 : value;
    }
  }
}

function clamp(value) {
  const v = Math.round(value);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
