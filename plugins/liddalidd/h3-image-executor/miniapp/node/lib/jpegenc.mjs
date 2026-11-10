// 纯 Node 实现的 baseline JPEG 编码器（4:2:0 抽样，标准 Annex K 量化表与霍夫曼表）。
//
// 存在的理由：分享页把图内嵌成 data URL，而 PNG 存照片极不划算——实测 640px 的交付预览图
// 平均 780KB/张，占整页七成体积（20261110-c46dde 16.9MB、20261109-11b90b 19.4MB），
// 大到 website_deploy 部署不动。同一张图存成 q82 的 JPEG 只要几十 KB。
//
// 只做 baseline：8bit、3 分量、4:2:0、无 restart interval。与 jpeg.mjs 的解码器成对，
// 编码出来的图能被它解回来（测试里做往返比对）。
// 不支持 progressive / arithmetic coding / 12bit——分享页用不上，徒增风险。

const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];

// Annex K 表 K.1 / K.2，自然顺序（不是 zigzag）。写进 DQT 时才按 zigzag 重排。
const QUANT_LUMA = [
  16, 11, 10, 16, 24, 40, 51, 61,
  12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77,
  24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99,
];

const QUANT_CHROMA = [
  17, 18, 24, 47, 99, 99, 99, 99,
  18, 21, 26, 66, 99, 99, 99, 99,
  24, 26, 56, 99, 99, 99, 99, 99,
  47, 66, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
];

// Annex K 表 K.3：标准霍夫曼码长与符号。
const DC_LUMA_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_LUMA_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const DC_CHROMA_BITS = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
const DC_CHROMA_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

const AC_LUMA_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const AC_LUMA_VALS = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
  0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
  0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
  0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
  0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
  0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
  0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
];

const AC_CHROMA_BITS = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77];
const AC_CHROMA_VALS = [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
  0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
  0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
  0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
  0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
  0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
  0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
  0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
  0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
  0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
];

// 与 jpeg.mjs 解码器同一套余弦表，保证正变换与逆变换严格配对。
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

export const DEFAULT_QUALITY = 82;

// IJG 的质量到量化缩放：q=50 时原表不变，q 越大量化步长越小。
export function scaleQuantTable(base, quality) {
  const q = Math.max(1, Math.min(100, Math.round(quality)));
  const scale = q < 50 ? 5000 / q : 200 - q * 2;
  const out = new Int32Array(64);
  for (let i = 0; i < 64; i += 1) {
    // 钳到 1..255：0 会让解码端除零，>255 在 8bit 精度下写不进 DQT。
    out[i] = Math.max(1, Math.min(255, Math.floor((base[i] * scale + 50) / 100)));
  }
  return out;
}

// 由码长表生成「符号 -> {code,length}」。JPEG 的规范霍夫曼码是按码长递增、
// 同码长内按符号表顺序连续分配的，不需要真的建霍夫曼树。
function buildCodeTable(bits, values) {
  const table = new Array(256);
  let code = 0;
  let k = 0;
  for (let length = 1; length <= 16; length += 1) {
    for (let i = 0; i < bits[length - 1]; i += 1) {
      table[values[k]] = { code, length };
      code += 1;
      k += 1;
    }
    code <<= 1;
  }
  return table;
}

class BitWriter {
  constructor() {
    this.bytes = [];
    this.acc = 0;
    this.nbits = 0;
  }

  write(code, length) {
    if (!length) return;
    for (let i = length - 1; i >= 0; i -= 1) {
      this.acc = (this.acc << 1) | ((code >> i) & 1);
      this.nbits += 1;
      if (this.nbits === 8) this.emitByte();
    }
  }

  emitByte() {
    const byte = this.acc & 0xff;
    this.bytes.push(byte);
    // 熵编码段里 0xFF 后面必须补 0x00，否则会被当成标记。这是 JPEG 唯一的转义规则。
    if (byte === 0xff) this.bytes.push(0x00);
    this.acc = 0;
    this.nbits = 0;
  }

  // 末尾不足一字节时用 1 补齐（JPEG 规范要求填 1，不是填 0）。
  flush() {
    if (this.nbits === 0) return;
    const pad = 8 - this.nbits;
    this.acc = ((this.acc << pad) | ((1 << pad) - 1)) & 0xff;
    this.nbits = 8;
    this.emitByte();
  }
}

function categoryOf(value) {
  let v = Math.abs(value);
  let n = 0;
  while (v) {
    n += 1;
    v >>= 1;
  }
  return n;
}

// 负数用补码表示：-3 在 3bit 下写成 100（= 4）。这是 JPEG 的定长幅度编码。
function magnitudeBits(value, category) {
  return value >= 0 ? value : value + (1 << category) - 1;
}

function forwardDct(input, output, tmp) {
  for (let y = 0; y < 8; y += 1) {
    for (let u = 0; u < 8; u += 1) {
      let sum = 0;
      for (let x = 0; x < 8; x += 1) sum += input[y * 8 + x] * COS[u * 8 + x];
      tmp[y * 8 + u] = sum;
    }
  }
  for (let x = 0; x < 8; x += 1) {
    for (let v = 0; v < 8; v += 1) {
      let sum = 0;
      for (let y = 0; y < 8; y += 1) sum += tmp[y * 8 + x] * COS[v * 8 + y];
      output[v * 8 + x] = sum;
    }
  }
}

function encodeBlock(writer, coefficients, quant, dcTable, acTable, previousDc) {
  const quantized = new Int32Array(64);
  for (let i = 0; i < 64; i += 1) {
    quantized[i] = Math.round(coefficients[i] / quant[i]);
  }

  const dc = quantized[0];
  const diff = dc - previousDc;
  const dcCategory = categoryOf(diff);
  const dcCode = dcTable[dcCategory];
  if (!dcCode) throw new Error('jpeg_bad_dc_category');
  writer.write(dcCode.code, dcCode.length);
  if (dcCategory) writer.write(magnitudeBits(diff, dcCategory), dcCategory);

  let run = 0;
  for (let i = 1; i < 64; i += 1) {
    const value = quantized[ZIGZAG[i]];
    if (value === 0) {
      run += 1;
      continue;
    }
    // 游程最多 15，超过就用 ZRL（0xF0）分段。
    while (run > 15) {
      const zrl = acTable[0xf0];
      writer.write(zrl.code, zrl.length);
      run -= 16;
    }
    const category = categoryOf(value);
    const symbol = (run << 4) | category;
    const acCode = acTable[symbol];
    if (!acCode) throw new Error('jpeg_bad_ac_symbol');
    writer.write(acCode.code, acCode.length);
    writer.write(magnitudeBits(value, category), category);
    run = 0;
  }
  if (run > 0) {
    const eob = acTable[0x00];
    writer.write(eob.code, eob.length);
  }
  return dc;
}

function marker(type, payload) {
  const head = Buffer.alloc(4);
  head[0] = 0xff;
  head[1] = type;
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

function buildDqt(tables) {
  const parts = [];
  for (const [id, table] of tables) {
    const body = Buffer.alloc(65);
    body[0] = id; // 精度 0（8bit）+ 表号
    for (let i = 0; i < 64; i += 1) body[1 + i] = table[ZIGZAG[i]];
    parts.push(body);
  }
  return marker(0xdb, Buffer.concat(parts));
}

function buildDht(tables) {
  const parts = [];
  for (const [tableClass, id, bits, values] of tables) {
    const body = Buffer.alloc(1 + 16 + values.length);
    body[0] = (tableClass << 4) | id;
    for (let i = 0; i < 16; i += 1) body[1 + i] = bits[i];
    for (let i = 0; i < values.length; i += 1) body[17 + i] = values[i];
    parts.push(body);
  }
  return marker(0xc4, Buffer.concat(parts));
}

function buildJfif() {
  const body = Buffer.alloc(14);
  body.write('JFIF', 0, 'ascii');
  body[4] = 0;
  body[5] = 1; // version 1.1
  body[6] = 1;
  body[7] = 0; // 单位：0 = 无单位
  body.writeUInt16BE(1, 8);
  body.writeUInt16BE(1, 10);
  body[12] = 0; // 无缩略图
  body[13] = 0;
  return marker(0xe0, body);
}

function buildSof0(width, height) {
  const body = Buffer.alloc(15);
  body[0] = 8; // 8bit 精度
  body.writeUInt16BE(height, 1);
  body.writeUInt16BE(width, 3);
  body[5] = 3;
  // Y 取 2x2、Cb/Cr 各 1x1 —— 这就是 4:2:0。
  body[6] = 1; body[7] = 0x22; body[8] = 0;
  body[9] = 2; body[10] = 0x11; body[11] = 1;
  body[12] = 3; body[13] = 0x11; body[14] = 1;
  return marker(0xc0, body);
}

function buildSos() {
  const body = Buffer.alloc(10);
  body[0] = 3;
  body[1] = 1; body[2] = 0x00; // Y: DC0 / AC0
  body[3] = 2; body[4] = 0x11; // Cb: DC1 / AC1
  body[5] = 3; body[6] = 0x11; // Cr: DC1 / AC1
  body[7] = 0; // Ss
  body[8] = 63; // Se
  body[9] = 0; // Ah / Al
  return marker(0xda, body);
}

// 从原图取一个 8x8 块，边缘用夹取（复制最后一行/列）补齐。
function extractBlock(plane, planeWidth, planeHeight, blockX, blockY, out) {
  for (let y = 0; y < 8; y += 1) {
    const sy = Math.min(planeHeight - 1, blockY * 8 + y);
    const row = sy * planeWidth;
    for (let x = 0; x < 8; x += 1) {
      const sx = Math.min(planeWidth - 1, blockX * 8 + x);
      // DCT 输入要减 128 做中心化：解码端 IDCT 之后会加回来。
      out[y * 8 + x] = plane[row + sx] - 128;
    }
  }
}

/**
 * 把一张图编码成 baseline JPEG。
 * @param {{width:number,height:number,channels:number,data:Buffer|Uint8Array}} image
 * @param {{quality?:number}} [options] quality 1..100，默认 82
 * @returns {Buffer}
 */
export function encodeJpeg(image, options) {
  const width = image.width | 0;
  const height = image.height | 0;
  const channels = image.channels || 3;
  const data = image.data;
  if (width <= 0 || height <= 0) throw new Error('jpeg_bad_size');
  if (channels !== 1 && channels !== 3 && channels !== 4) throw new Error('jpeg_bad_channels');

  const quality = options && options.quality !== undefined ? options.quality : DEFAULT_QUALITY;
  const quantLuma = scaleQuantTable(QUANT_LUMA, quality);
  const quantChroma = scaleQuantTable(QUANT_CHROMA, quality);

  const dcLuma = buildCodeTable(DC_LUMA_BITS, DC_LUMA_VALS);
  const acLuma = buildCodeTable(AC_LUMA_BITS, AC_LUMA_VALS);
  const dcChroma = buildCodeTable(DC_CHROMA_BITS, DC_CHROMA_VALS);
  const acChroma = buildCodeTable(AC_CHROMA_BITS, AC_CHROMA_VALS);

  const chromaWidth = Math.ceil(width / 2);
  const chromaHeight = Math.ceil(height / 2);
  const luma = new Float32Array(width * height);
  const cb = new Float32Array(chromaWidth * chromaHeight);
  const cr = new Float32Array(chromaWidth * chromaHeight);

  const readRgb = (x, y, out) => {
    const index = (y * width + x) * channels;
    if (channels === 1) {
      out[0] = data[index];
      out[1] = data[index];
      out[2] = data[index];
      return;
    }
    out[0] = data[index];
    out[1] = data[index + 1];
    out[2] = data[index + 2];
  };

  const rgb = new Float32Array(3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      readRgb(x, y, rgb);
      luma[y * width + x] = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
    }
  }
  // 色度按 2x2 平均降采样。直接取左上角像素会丢一半信息，细密彩色纹理会出现色块。
  for (let cy = 0; cy < chromaHeight; cy += 1) {
    for (let cx = 0; cx < chromaWidth; cx += 1) {
      let sumB = 0;
      let sumR = 0;
      let count = 0;
      for (let dy = 0; dy < 2; dy += 1) {
        const y = cy * 2 + dy;
        if (y >= height) continue;
        for (let dx = 0; dx < 2; dx += 1) {
          const x = cx * 2 + dx;
          if (x >= width) continue;
          readRgb(x, y, rgb);
          sumB += 128 - 0.168736 * rgb[0] - 0.331264 * rgb[1] + 0.5 * rgb[2];
          sumR += 128 + 0.5 * rgb[0] - 0.418688 * rgb[1] - 0.081312 * rgb[2];
          count += 1;
        }
      }
      cb[cy * chromaWidth + cx] = sumB / count;
      cr[cy * chromaWidth + cx] = sumR / count;
    }
  }

  const writer = new BitWriter();
  const block = new Float32Array(64);
  const coefficients = new Float32Array(64);
  const tmp = new Float32Array(64);

  const mcusPerLine = Math.ceil(width / 16);
  const mcusPerColumn = Math.ceil(height / 16);
  let dcY = 0;
  let dcCb = 0;
  let dcCr = 0;

  for (let mcuY = 0; mcuY < mcusPerColumn; mcuY += 1) {
    for (let mcuX = 0; mcuX < mcusPerLine; mcuX += 1) {
      // 一个 4:2:0 MCU = 4 个亮度块 + 1 个 Cb + 1 个 Cr，顺序固定。
      for (let by = 0; by < 2; by += 1) {
        for (let bx = 0; bx < 2; bx += 1) {
          extractBlock(luma, width, height, mcuX * 2 + bx, mcuY * 2 + by, block);
          forwardDct(block, coefficients, tmp);
          dcY = encodeBlock(writer, coefficients, quantLuma, dcLuma, acLuma, dcY);
        }
      }
      extractBlock(cb, chromaWidth, chromaHeight, mcuX, mcuY, block);
      forwardDct(block, coefficients, tmp);
      dcCb = encodeBlock(writer, coefficients, quantChroma, dcChroma, acChroma, dcCb);
      extractBlock(cr, chromaWidth, chromaHeight, mcuX, mcuY, block);
      forwardDct(block, coefficients, tmp);
      dcCr = encodeBlock(writer, coefficients, quantChroma, dcChroma, acChroma, dcCr);
    }
  }
  writer.flush();

  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    buildJfif(),
    buildDqt([[0, quantLuma], [1, quantChroma]]),
    buildSof0(width, height),
    buildDht([
      [0, 0, DC_LUMA_BITS, DC_LUMA_VALS],
      [1, 0, AC_LUMA_BITS, AC_LUMA_VALS],
      [0, 1, DC_CHROMA_BITS, DC_CHROMA_VALS],
      [1, 1, AC_CHROMA_BITS, AC_CHROMA_VALS],
    ]),
    buildSos(),
    Buffer.from(writer.bytes),
    Buffer.from([0xff, 0xd9]),
  ]);
}
