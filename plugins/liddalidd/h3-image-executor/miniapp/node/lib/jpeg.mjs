// 纯 Node 实现的 baseline JPEG 解码器（不支持 progressive / arithmetic coding）。
// 存在的理由：参考图（真人照片、车型图、用户上传图）绝大多数是 JPEG，
// 没有它评审就看不到参考图，一致性判断只能靠猜。
// 支持 8bit、1 或 3 分量、4:4:4 / 4:2:2 / 4:2:0 / 4:1:1 抽样、restart interval。

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

export function isJpeg(buffer) {
  return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

export function decodeJpeg(buffer) {
  const quantTables = [];
  const huffDC = [];
  const huffAC = [];
  let frame = null;
  let restartInterval = 0;
  let offset = 2;

  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9) break;
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
    } else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (marker !== 0xc0 && marker !== 0xc1) throw new Error('jpeg_progressive_unsupported');
      const height = segment.readUInt16BE(1);
      const width = segment.readUInt16BE(3);
      const count = segment[5];
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
      frame = { width, height, components };
    } else if (marker === 0xda) {
      if (!frame) throw new Error('jpeg_no_frame');
      const count = segment[0];
      for (let i = 0; i < count; i += 1) {
        const id = segment[1 + i * 2];
        const tables = segment[2 + i * 2];
        const component = frame.components.find((item) => item.id === id);
        if (component) {
          component.dcId = tables >> 4;
          component.acId = tables & 15;
        }
      }
      return decodeScan(buffer, offset + length, frame, quantTables, huffDC, huffAC, restartInterval);
    }
    offset += length;
  }
  throw new Error('jpeg_no_scan');
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

function decodeScan(buffer, start, frame, quantTables, huffDC, huffAC, restartInterval) {
  const { width, height, components } = frame;
  const hmax = Math.max(...components.map((c) => c.h));
  const vmax = Math.max(...components.map((c) => c.v));
  const mcusPerLine = Math.ceil(width / (8 * hmax));
  const mcusPerColumn = Math.ceil(height / (8 * vmax));

  for (const component of components) {
    component.blocksPerLine = mcusPerLine * component.h;
    component.blocksPerColumn = mcusPerColumn * component.v;
    component.pixels = new Uint8Array(component.blocksPerLine * 8 * component.blocksPerColumn * 8);
    component.pred = 0;
    component.quant = quantTables[component.quantId] || new Int32Array(64).fill(1);
    component.dc = huffDC[component.dcId];
    component.ac = huffAC[component.acId];
    if (!component.dc || !component.ac) throw new Error('jpeg_missing_huffman');
  }

  const reader = new BitReader(buffer, start);
  const block = new Int32Array(64);
  const pixels = new Uint8Array(64);
  let mcu = 0;

  for (let mcuRow = 0; mcuRow < mcusPerColumn; mcuRow += 1) {
    for (let mcuCol = 0; mcuCol < mcusPerLine; mcuCol += 1) {
      if (restartInterval && mcu && mcu % restartInterval === 0) {
        reader.restart();
        for (const component of components) component.pred = 0;
      }
      mcu += 1;
      for (const component of components) {
        for (let v = 0; v < component.v; v += 1) {
          for (let h = 0; h < component.h; h += 1) {
            const row = mcuRow * component.v + v;
            const col = mcuCol * component.h + h;
            decodeBlock(reader, component, block);
            idct(block, pixels);
            const stride = component.blocksPerLine * 8;
            for (let y = 0; y < 8; y += 1) {
              const target = (row * 8 + y) * stride + col * 8;
              for (let x = 0; x < 8; x += 1) component.pixels[target + x] = pixels[y * 8 + x];
            }
          }
        }
      }
    }
  }

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
  const [Y, Cb, Cr] = planes;
  for (let p = 0; p < width * height; p += 1) {
    const y = Y[p];
    const cb = Cb[p] - 128;
    const cr = Cr[p] - 128;
    const di = p * 3;
    out[di] = clamp(y + 1.402 * cr);
    out[di + 1] = clamp(y - 0.344136 * cb - 0.714136 * cr);
    out[di + 2] = clamp(y + 1.772 * cb);
  }
  return { width, height, channels: 3, data: out };
}

// 把某个分量的 MCU 块平面上采样到整图分辨率。
// 采样中心映射 src = (dst + 0.5) * (h / hmax) - 0.5，与 libjpeg 的 fancy（三角 3:1）上采样等价。
function upsample(component, width, height, hmax, vmax) {
  const stride = component.blocksPerLine * 8;
  const rows = component.blocksPerColumn * 8;
  const src = component.pixels;
  const out = new Uint8Array(width * height);
  const rx = component.h / hmax;
  const ry = component.v / vmax;
  const identity = rx === 1 && ry === 1;
  if (identity) {
    for (let y = 0; y < height; y += 1) {
      const sy = Math.min(rows - 1, y);
      for (let x = 0; x < width; x += 1) out[y * width + x] = src[sy * stride + Math.min(stride - 1, x)];
    }
    return out;
  }
  for (let y = 0; y < height; y += 1) {
    const fy = (y + 0.5) * ry - 0.5;
    const y0 = Math.floor(fy);
    const wy = fy - y0;
    const ya = Math.min(rows - 1, Math.max(0, y0)) * stride;
    const yb = Math.min(rows - 1, Math.max(0, y0 + 1)) * stride;
    for (let x = 0; x < width; x += 1) {
      const fx = (x + 0.5) * rx - 0.5;
      const x0 = Math.floor(fx);
      const wx = fx - x0;
      const xa = Math.min(stride - 1, Math.max(0, x0));
      const xb = Math.min(stride - 1, Math.max(0, x0 + 1));
      const top = src[ya + xa] + (src[ya + xb] - src[ya + xa]) * wx;
      const bottom = src[yb + xa] + (src[yb + xb] - src[yb + xa]) * wx;
      out[y * width + x] = Math.round(top + (bottom - top) * wy);
    }
  }
  return out;
}

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
      let byte = this.data[this.pos];
      this.pos += 1;
      if (byte === 0xff) {
        const next = this.data[this.pos];
        if (next === 0x00) this.pos += 1;
        else {
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

function decodeBlock(reader, component, block) {
  block.fill(0);
  const t = decodeHuffman(reader, component.dc);
  const diff = t ? extend(reader.receive(t), t) : 0;
  component.pred += diff;
  block[0] = component.pred * component.quant[0];
  let k = 1;
  while (k < 64) {
    const rs = decodeHuffman(reader, component.ac);
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
    block[z] = extend(reader.receive(size), size) * component.quant[z];
    k += 1;
  }
}

function extend(value, length) {
  return value < 1 << (length - 1) ? value - (1 << length) + 1 : value;
}

function idct(block, out) {
  const tmp = new Float32Array(64);
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
