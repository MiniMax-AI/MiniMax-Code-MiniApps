// Original MiniMax Pet artwork. Copyright MiniMax. SPDX-License-Identifier: MIT
// Every shape is drawn here; generation needs no external images, fonts or packages.
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CELL_W = 192;
const CELL_H = 208;
const COLUMNS = 8;
const COUNTS = [6, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8];
const INK = [35, 55, 58, 255];
const MINT = [109, 218, 184, 255];
const LIGHT = [178, 243, 214, 255];
const CREAM = [249, 252, 233, 255];
const CORAL = [248, 119, 108, 255];
const GOLD = [255, 207, 103, 255];

function canvas(width, height) {
  const pixels = Buffer.alloc(width * height * 4);
  function pixel(x, y, color) {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const offset = (Math.floor(y) * width + Math.floor(x)) * 4;
    for (let i = 0; i < 4; i++) pixels[offset + i] = color[i];
  }
  function rect(x, y, w, h, color) {
    for (let py = Math.ceil(y); py < y + h; py++) {
      for (let px = Math.ceil(x); px < x + w; px++) pixel(px, py, color);
    }
  }
  function ellipse(cx, cy, rx, ry, color) {
    for (let y = Math.ceil(cy - ry); y <= cy + ry; y++) {
      for (let x = Math.ceil(cx - rx); x <= cx + rx; x++) {
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) pixel(x, y, color);
      }
    }
  }
  function roundRect(x, y, w, h, radius, color) {
    rect(x + radius, y, w - 2 * radius, h, color);
    rect(x, y + radius, w, h - 2 * radius, color);
    for (const cx of [x + radius, x + w - radius - 1]) {
      for (const cy of [y + radius, y + h - radius - 1]) {
        ellipse(cx, cy, radius, radius, color);
      }
    }
  }
  function line(x1, y1, x2, y2, thickness, color) {
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      ellipse(Math.round(x1 + (x2 - x1) * t), Math.round(y1 + (y2 - y1) * t), thickness / 2, thickness / 2, color);
    }
  }
  return { pixels, rect, ellipse, roundRect, line };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(name, data) {
  const kind = Buffer.from(name, 'ascii');
  const size = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([kind, data])));
  return Buffer.concat([size, kind, data, checksum]);
}

function encodePng(width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6; // Eight-bit RGBA, preserving transparent cell backgrounds.
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    pixels.copy(scanlines, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function drawPet(sheet, row, frame) {
  // Drawing on a 96 x 104 grid gives every sprite a clean two-pixel edge.
  const small = canvas(CELL_W / 2, CELL_H / 2);
  const { rect, ellipse, roundRect, line } = small;
  const cycle = frame / COUNTS[row] * Math.PI * 2;
  const stride = Math.round(Math.sin(cycle) * 5);
  const runningSide = row === 1 || row === 2;
  const jump = row === 4 ? [0, 7, 15, 7, 0][frame] : 0;
  const bob = runningSide || row === 7 ? (frame % 2 ? -1 : 1) : (row === 0 && frame === 3 ? 1 : 0);
  const sad = row === 5;
  const headDrop = sad ? [0, 1, 2, 3, 3, 2, 1, 0][frame] : 0;
  const dx = runningSide ? (row === 1 ? 2 : -2) : 0;
  const dy = bob - jump;
  const headY = 28 + dy + headDrop;
  const bodyY = 62 + dy;
  const lookAngle = row >= 9 ? ((row - 9) * 8 + frame) * Math.PI / 8 : null;
  const gazeX = lookAngle === null ? (row === 1 ? 2 : row === 2 ? -2 : 0) : Math.round(Math.sin(lookAngle) * 3);
  const gazeY = lookAngle === null ? 0 : Math.round(-Math.cos(lookAngle) * 2);

  // A small coral antenna is the pet's identifying accent.
  line(48 + dx, headY - 6, 48 + dx, headY + 1, 3, INK);
  ellipse(48 + dx, headY - 7, 4, 4, INK);
  ellipse(48 + dx, headY - 8, 2.5, 2.5, CORAL);

  // Feet move independently during walking and running, staying inside the cell.
  const legL = runningSide || row === 7 ? stride : (row === 4 ? -2 : 0);
  const legR = runningSide || row === 7 ? -stride : (row === 4 ? 2 : 0);
  line(39 + dx, bodyY + 18, 38 + dx + legL, bodyY + 29, 6, INK);
  line(57 + dx, bodyY + 18, 58 + dx + legR, bodyY + 29, 6, INK);
  roundRect(29 + dx + legL, bodyY + 26, 14, 7, 2, INK);
  roundRect(54 + dx + legR, bodyY + 26, 14, 7, 2, INK);
  rect(32 + dx + legL, bodyY + 27, 9, 3, MINT);
  rect(56 + dx + legR, bodyY + 27, 9, 3, MINT);

  // Rounded forearms make the four-frame wave legible at small display sizes.
  const leftEnd = row === 4 ? [22 + dx, bodyY - 5] : [27 + dx, bodyY + 14 + (runningSide ? stride : 0)];
  const rightEnd = row === 3
    ? [[75, 43], [80, 35], [75, 30], [72, 38]][frame].map((n, i) => n + (i ? dy : dx))
    : row === 4 ? [74 + dx, bodyY - 5]
      : row === 8 ? [70 + dx, bodyY - 6] : [69 + dx, bodyY + 14 - (runningSide ? stride : 0)];
  for (const [startX, end] of [[34 + dx, leftEnd], [62 + dx, rightEnd]]) {
    line(startX, bodyY + 4, end[0], end[1], 9, INK);
    line(startX, bodyY + 4, end[0], end[1], 5, MINT);
    ellipse(end[0], end[1], 4, 4, INK);
    ellipse(end[0], end[1] - 1, 2.5, 2.5, LIGHT);
  }

  roundRect(32 + dx, bodyY - 1, 33, 25, 6, INK);
  roundRect(34 + dx, bodyY + 1, 29, 21, 4, MINT);
  rect(39 + dx, bodyY + 4, 19, 2, LIGHT);
  roundRect(42 + dx, bodyY + 9, 13, 8, 2, INK);
  rect(45 + dx, bodyY + 11, 7, 3, row === 7 ? GOLD : CORAL);

  // Wide cream face, mint shell and two tiny ears: all original geometric art.
  roundRect(19 + dx, headY + 9, 8, 16, 3, INK);
  roundRect(69 + dx, headY + 9, 8, 16, 3, INK);
  rect(21 + dx, headY + 12, 4, 9, MINT);
  rect(71 + dx, headY + 12, 4, 9, MINT);
  roundRect(24 + dx, headY, 49, 37, 10, INK);
  roundRect(26 + dx, headY + 2, 45, 33, 8, MINT);
  rect(33 + dx, headY + 4, 26, 2, LIGHT);
  roundRect(29 + dx, headY + 8, 39, 24, 6, INK);
  roundRect(31 + dx, headY + 10, 35, 20, 4, CREAM);

  const eyesY = headY + 18 + gazeY;
  const blinking = row === 0 && frame === 1;
  const blinkWaiting = row === 6 && frame === 4;
  for (const eyeX of [39 + dx + gazeX, 57 + dx + gazeX]) {
    if (blinking || blinkWaiting) line(eyeX - 2, eyesY, eyeX + 2, eyesY, 2, INK);
    else if (sad) {
      line(eyeX - 2, eyesY + 1, eyeX + 2, eyesY - 1, 2, INK);
    } else {
      roundRect(eyeX - 2, eyesY - 3, 5, 7, 1, INK);
      rect(eyeX - 1, eyesY - 2, 1, 2, [255, 255, 255, 255]);
    }
  }
  if (sad) {
    line(46 + dx, headY + 27, 48 + dx, headY + 25, 1, INK);
    line(48 + dx, headY + 25, 50 + dx, headY + 27, 1, INK);
  } else if (row === 4 || row === 3) {
    roundRect(45 + dx, headY + 24, 7, 5, 2, INK);
    rect(47 + dx, headY + 27, 3, 1, CORAL);
  } else {
    line(45 + dx, headY + 24, 47 + dx, headY + 26, 1, INK);
    line(47 + dx, headY + 26, 50 + dx, headY + 24, 1, INK);
  }
  rect(33 + dx, headY + 23, 3, 2, [247, 187, 165, 255]);
  rect(60 + dx, headY + 23, 3, 2, [247, 187, 165, 255]);

  if (row === 6) {
    // Sequential dots communicate waiting without text or an imported glyph.
    for (let i = 0; i < 3; i++) ellipse(35 + i * 12, 8, 2, 2, i <= frame % 3 ? CORAL : LIGHT);
  }
  if (row === 7) {
    // Two alternating sparks accompany the working expression.
    for (const [x, y] of frame % 2 ? [[14, 52], [79, 72]] : [[15, 70], [79, 49]]) {
      line(x - 3, y, x + 3, y, 2, GOLD);
      line(x, y - 3, x, y + 3, 2, GOLD);
    }
  }
  if (row === 8) {
    // A raised hand and soft pulse ask for attention.
    const y = 12 + (frame % 2);
    roundRect(76, y, 5, 10, 2, CORAL);
    ellipse(78, y + 14, 2, 2, CORAL);
  }

  const atlasWidth = CELL_W * COLUMNS;
  for (let y = 0; y < CELL_H / 2; y++) {
    for (let x = 0; x < CELL_W / 2; x++) {
      const input = (y * CELL_W / 2 + x) * 4;
      for (let iy = 0; iy < 2; iy++) {
        for (let ix = 0; ix < 2; ix++) {
          const output = (((row * CELL_H + y * 2 + iy) * atlasWidth) + frame * CELL_W + x * 2 + ix) * 4;
          small.pixels.copy(sheet, output, input, input + 4);
        }
      }
    }
  }
}

/** Create a complete deterministic PNG atlas without reading or writing files. */
export function createPetAtlas({ version = 2 } = {}) {
  if (version !== 1 && version !== 2) throw new RangeError('Pet atlas version must be 1 or 2');
  const width = CELL_W * COLUMNS;
  const rows = version === 1 ? 9 : 11;
  const height = CELL_H * rows;
  const pixels = Buffer.alloc(width * height * 4);
  for (let row = 0; row < rows; row++) {
    for (let frame = 0; frame < COUNTS[row]; frame++) drawPet(pixels, row, frame);
  }
  return encodePng(width, height, pixels);
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const destination = path.join(root, 'miniapp/client/pets/minimax-original');
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, 'spritesheet.png'), createPetAtlas());
  const metadata = {
    id: 'minimax-original',
    displayName: 'MiniMax Pet',
    description: 'MiniMax 原创薄荷色机器人。图集由随包源代码独立绘制，采用 MIT 许可。',
    spritesheetPath: 'spritesheet.png',
    spriteVersionNumber: 2,
    author: 'MiniMax',
    license: 'MIT',
  };
  await writeFile(path.join(destination, 'pet.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  process.stdout.write('Generated original MiniMax Pet v2 atlas (1536 x 2288); the separately authored icon.png is preserved.\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
