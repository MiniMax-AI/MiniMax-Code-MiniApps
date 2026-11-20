// 二维码编码器（QR Code Model 2，ISO/IEC 18004）。纯 Node 实现，零第三方依赖。
//
// 存在的理由：生图模型画不出能扫的二维码。它画的只是「长得像二维码」的黑白方块，解码器一个都扫不出来
// （真机 20261111-606a7e：两张候选的码都扫不出内容，评审只核对了「像不像二维码」，照样放行）。
// 所以图里要放二维码时，由程序生成真码，再贴回模型画的位置（见 qrfix.mjs）。
//
// 支持版本 1–40、纠错等级 L/M/Q/H，以及数字、字母数字、字节（UTF-8）三种模式；整段内容只用一种模式。
// 步骤按标准来：Reed-Solomon 纠错、分块交织，8 种掩码按罚分选最优。

const ECL = {
  L: { ordinal: 0, formatBits: 1 },
  M: { ordinal: 1, formatBits: 0 },
  Q: { ordinal: 2, formatBits: 3 },
  H: { ordinal: 3, formatBits: 2 },
};
export const ECL_LEVELS = ['L', 'M', 'Q', 'H'];

// 每块纠错码字数、纠错块数，按 [纠错等级][版本] 取；下标 0 不用。
const ECC_CODEWORDS_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_ERROR_CORRECTION_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

const MODES = {
  numeric: { indicator: 0x1, countBits: [10, 12, 14] },
  alphanumeric: { indicator: 0x2, countBits: [9, 11, 13] },
  byte: { indicator: 0x4, countBits: [8, 16, 16] },
};
const ALPHANUMERIC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

// 生成一枚二维码。返回 { version, size, ecl, mask, mode, content, modules }，
// modules 是 size*size 的 Uint8Array，按行存，1 = 深色模块。
//
// options.ecl：纠错等级，默认 M。boostEcl（默认开）会在不升版本的前提下把纠错等级往上提：
// 同样大小的码，纠错越高越耐脏、耐遮挡。
export function encodeQr(text, options) {
  const opts = options || {};
  const content = String(text === undefined || text === null ? '' : text);
  if (!content) throw new Error('qr_empty_content');
  let ecl = ECL_LEVELS.includes(opts.ecl) ? opts.ecl : 'M';
  const minVersion = clampInt(opts.minVersion, 1, 40, 1);
  const maxVersion = clampInt(opts.maxVersion, minVersion, 40, 40);
  const segment = makeSegment(content);

  let version = minVersion;
  let usedBits = 0;
  for (;;) {
    const countBits = charCountBits(segment.mode, version);
    const capacity = getNumDataCodewords(version, ecl) * 8;
    usedBits = segment.count < 2 ** countBits ? 4 + countBits + segment.bits.length : Infinity;
    if (usedBits <= capacity) break;
    if (version >= maxVersion) throw new Error('qr_content_too_long');
    version += 1;
  }
  if (opts.boostEcl !== false) {
    for (const level of ['M', 'Q', 'H']) {
      if (ECL[level].ordinal > ECL[ecl].ordinal && usedBits <= getNumDataCodewords(version, level) * 8) ecl = level;
    }
  }

  const bits = [];
  appendBits(bits, segment.mode.indicator, 4);
  appendBits(bits, segment.count, charCountBits(segment.mode, version));
  for (const bit of segment.bits) bits.push(bit);
  const capacity = getNumDataCodewords(version, ecl) * 8;
  appendBits(bits, 0, Math.min(4, capacity - bits.length));
  appendBits(bits, 0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) appendBits(bits, pad, 8);
  const data = new Array(bits.length / 8).fill(0);
  bits.forEach((bit, index) => {
    data[index >>> 3] |= bit << (7 - (index & 7));
  });

  const size = version * 4 + 17;
  const qr = { version, size, ecl, modules: new Uint8Array(size * size), isFunction: new Uint8Array(size * size) };
  drawFunctionPatterns(qr);
  drawCodewords(qr, addEccAndInterleave(qr, data));

  let mask = Number.isInteger(opts.mask) && opts.mask >= 0 && opts.mask <= 7 ? opts.mask : -1;
  if (mask < 0) {
    let best = Infinity;
    for (let candidate = 0; candidate < 8; candidate += 1) {
      applyMask(qr, candidate);
      drawFormatBits(qr, candidate);
      const penalty = getPenaltyScore(qr);
      if (penalty < best) {
        best = penalty;
        mask = candidate;
      }
      applyMask(qr, candidate);
    }
  }
  applyMask(qr, mask);
  drawFormatBits(qr, mask);
  return { version, size, ecl, mask, mode: segment.name, content, modules: qr.modules };
}

// 把码画成一张图（带静区），用于命令行的 make 子命令和测试。
export function renderQr(qr, options) {
  const opts = options || {};
  const modulePx = clampInt(opts.modulePx, 1, 64, 10);
  const quiet = clampInt(opts.quiet, 0, 16, 4);
  const dark = opts.dark || [0, 0, 0];
  const light = opts.light || [255, 255, 255];
  const side = (qr.size + quiet * 2) * modulePx;
  const data = Buffer.alloc(side * side * 3);
  for (let y = 0; y < side; y += 1) {
    const my = Math.floor(y / modulePx) - quiet;
    for (let x = 0; x < side; x += 1) {
      const mx = Math.floor(x / modulePx) - quiet;
      const isDark = mx >= 0 && my >= 0 && mx < qr.size && my < qr.size && qr.modules[my * qr.size + mx] === 1;
      const color = isDark ? dark : light;
      const o = (y * side + x) * 3;
      data[o] = color[0];
      data[o + 1] = color[1];
      data[o + 2] = color[2];
    }
  }
  return { width: side, height: side, channels: 3, data };
}

// ---------------------------------------------------------------- 数据段

function makeSegment(text) {
  const bits = [];
  if (/^[0-9]+$/.test(text)) {
    for (let i = 0; i < text.length; ) {
      const n = Math.min(3, text.length - i);
      appendBits(bits, Number(text.slice(i, i + n)), n * 3 + 1);
      i += n;
    }
    return { mode: MODES.numeric, name: 'numeric', count: text.length, bits };
  }
  if (/^[0-9A-Z $%*+\-./:]+$/.test(text)) {
    let i = 0;
    for (; i + 2 <= text.length; i += 2) {
      appendBits(bits, ALPHANUMERIC.indexOf(text[i]) * 45 + ALPHANUMERIC.indexOf(text[i + 1]), 11);
    }
    if (i < text.length) appendBits(bits, ALPHANUMERIC.indexOf(text[i]), 6);
    return { mode: MODES.alphanumeric, name: 'alphanumeric', count: text.length, bits };
  }
  // 其余一律按 UTF-8 字节写。不加 ECI 声明：主流扫码器（微信、系统相机）都按 UTF-8 解，
  // 反倒是带 ECI 的码有些老扫码器不认。
  const bytes = Buffer.from(text, 'utf8');
  for (const byte of bytes) appendBits(bits, byte, 8);
  return { mode: MODES.byte, name: 'byte', count: bytes.length, bits };
}

function charCountBits(mode, version) {
  return mode.countBits[Math.floor((version + 7) / 17)];
}

function appendBits(bits, value, length) {
  if (length < 0 || length > 31 || value >>> length !== 0) throw new Error('qr_bits_out_of_range');
  for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
}

// ---------------------------------------------------------------- 容量

export function getNumRawDataModules(version) {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

export function getNumDataCodewords(version, ecl) {
  const o = ECL[ecl].ordinal;
  return Math.floor(getNumRawDataModules(version) / 8) - ECC_CODEWORDS_PER_BLOCK[o][version] * NUM_ERROR_CORRECTION_BLOCKS[o][version];
}

// ---------------------------------------------------------------- 功能图形

function setFunctionModule(qr, x, y, dark) {
  const index = y * qr.size + x;
  qr.modules[index] = dark ? 1 : 0;
  qr.isFunction[index] = 1;
}

function drawFunctionPatterns(qr) {
  const { size } = qr;
  for (let i = 0; i < size; i += 1) {
    setFunctionModule(qr, 6, i, i % 2 === 0);
    setFunctionModule(qr, i, 6, i % 2 === 0);
  }
  drawFinderPattern(qr, 3, 3);
  drawFinderPattern(qr, size - 4, 3);
  drawFinderPattern(qr, 3, size - 4);
  const positions = alignmentPatternPositions(qr.version);
  const count = positions.length;
  for (let i = 0; i < count; i += 1) {
    for (let j = 0; j < count; j += 1) {
      const onFinder = (i === 0 && j === 0) || (i === 0 && j === count - 1) || (i === count - 1 && j === 0);
      if (!onFinder) drawAlignmentPattern(qr, positions[i], positions[j]);
    }
  }
  drawFormatBits(qr, 0);
  drawVersion(qr);
}

function drawFinderPattern(qr, cx, cy) {
  for (let dy = -4; dy <= 4; dy += 1) {
    for (let dx = -4; dx <= 4; dx += 1) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= qr.size || y >= qr.size) continue;
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      setFunctionModule(qr, x, y, dist !== 2 && dist !== 4);
    }
  }
}

function drawAlignmentPattern(qr, cx, cy) {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      setFunctionModule(qr, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
}

export function alignmentPatternPositions(version) {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
  const result = [6];
  for (let pos = version * 4 + 17 - 7; result.length < count; pos -= step) result.splice(1, 0, pos);
  return result;
}

function drawFormatBits(qr, mask) {
  const { size } = qr;
  const data = (ECL[qr.ecl].formatBits << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i) => ((bits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i += 1) setFunctionModule(qr, 8, i, bit(i));
  setFunctionModule(qr, 8, 7, bit(6));
  setFunctionModule(qr, 8, 8, bit(7));
  setFunctionModule(qr, 7, 8, bit(8));
  for (let i = 9; i < 15; i += 1) setFunctionModule(qr, 14 - i, 8, bit(i));
  for (let i = 0; i < 8; i += 1) setFunctionModule(qr, size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i += 1) setFunctionModule(qr, 8, size - 15 + i, bit(i));
  setFunctionModule(qr, 8, size - 8, true);
}

function drawVersion(qr) {
  if (qr.version < 7) return;
  let rem = qr.version;
  for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (qr.version << 12) | rem;
  for (let i = 0; i < 18; i += 1) {
    const dark = ((bits >>> i) & 1) === 1;
    const a = qr.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    setFunctionModule(qr, a, b, dark);
    setFunctionModule(qr, b, a, dark);
  }
}

// ---------------------------------------------------------------- 纠错与码字排布

function addEccAndInterleave(qr, data) {
  const o = ECL[qr.ecl].ordinal;
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[o][qr.version];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[o][qr.version];
  const rawCodewords = Math.floor(getNumRawDataModules(qr.version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const divisor = reedSolomonDivisor(blockEccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < numBlocks; i += 1) {
    const block = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
    k += block.length;
    const ecc = reedSolomonRemainder(block, divisor);
    if (i < numShortBlocks) block.push(0);
    blocks.push(block.concat(ecc));
  }
  const result = [];
  for (let i = 0; i < blocks[0].length; i += 1) {
    blocks.forEach((block, j) => {
      // 短块在数据段末尾补了一个占位字节，交织时跳过。
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]);
    });
  }
  return result;
}

function reedSolomonDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < result.length; j += 1) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function reedSolomonRemainder(data, divisor) {
  const result = divisor.map(() => 0);
  for (const byte of data) {
    const factor = byte ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] ^= gfMultiply(coef, factor);
    });
  }
  return result;
}

function gfMultiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function drawCodewords(qr, data) {
  const { size } = qr;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        const index = y * size + x;
        if (!qr.isFunction[index] && i < data.length * 8) {
          qr.modules[index] = (data[i >>> 3] >>> (7 - (i & 7))) & 1;
          i += 1;
        }
      }
    }
  }
}

// ---------------------------------------------------------------- 掩码

function applyMask(qr, mask) {
  const { size } = qr;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let invert;
      switch (mask) {
        case 0: invert = (x + y) % 2 === 0; break;
        case 1: invert = y % 2 === 0; break;
        case 2: invert = x % 3 === 0; break;
        case 3: invert = (x + y) % 3 === 0; break;
        case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        case 7: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        default: throw new Error('qr_bad_mask');
      }
      const index = y * size + x;
      if (invert && !qr.isFunction[index]) qr.modules[index] ^= 1;
    }
  }
}

function getPenaltyScore(qr) {
  const { size, modules } = qr;
  let result = 0;
  for (let pass = 0; pass < 2; pass += 1) {
    for (let a = 0; a < size; a += 1) {
      let runColor = 0;
      let run = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      for (let b = 0; b < size; b += 1) {
        const color = pass === 0 ? modules[a * size + b] : modules[b * size + a];
        if (color === runColor) {
          run += 1;
          if (run === 5) result += PENALTY_N1;
          else if (run > 5) result += 1;
        } else {
          addHistory(run, history, size);
          if (!runColor) result += countFinderLike(history) * PENALTY_N3;
          runColor = color;
          run = 1;
        }
      }
      result += terminateAndCount(runColor, run, history, size) * PENALTY_N3;
    }
  }
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const color = modules[y * size + x];
      if (color === modules[y * size + x + 1] && color === modules[(y + 1) * size + x] && color === modules[(y + 1) * size + x + 1]) {
        result += PENALTY_N2;
      }
    }
  }
  let dark = 0;
  for (const value of modules) dark += value;
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  result += k * PENALTY_N4;
  return result;
}

function addHistory(run, history, size) {
  history.pop();
  history.unshift(history[0] === 0 ? run + size : run);
}

function countFinderLike(history) {
  const n = history[1];
  const core = n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
  return (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0) + (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0);
}

function terminateAndCount(runColor, run, history, size) {
  let length = run;
  if (runColor) {
    addHistory(length, history, size);
    length = 0;
  }
  addHistory(length + size, history, size);
  return countFinderLike(history);
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return n < min ? min : n > max ? max : n;
}
