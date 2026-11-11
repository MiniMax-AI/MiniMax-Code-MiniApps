// 评审材料准备：把"agent 自己写脚本裁图量像素"这件事彻底收进 harness。
//
// 设计目标：评审节点只需要 read 一张图就能看全整体、亮部、暗部和 1:1 局部，
// 不再需要裁图、拼图、量像素、跑统计。材料自带数字标签，评审可以直接引用"第 5 块"。
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { encodePng, downsample, drawImage, createCanvas, adjustGamma, analyze, detectDrift, detectOverSharpen } from './png.mjs';
import { decodeImage } from './image.mjs';

export const SHEET_WIDTH = 1024;
const TILE_COLS = 2;
const TILE_ROWS = 2;
const SEPARATOR = 3;
const LABEL_SCALE = 4;

export const CANDIDATE_SHEET_LAYOUT =
  '自上而下三段：第 1 段「1」= 整体预览（看构图、主体、氛围）；' +
  '第 2 段是两联，左「2」= 暗部提亮（看暗处有没有藏东西、多余物体、水印），右「3」= 亮部压暗（看高光有没有溢出死白）；' +
  '第 3 段「4」「5」「6」「7」= 局部放大，依次取自左上、右上、左下、右下象限的中心（看畸形、糊字、接缝、材质）。每块左上角有数字标签。';

// ---------------------------------------------------------------- 候选看图材料

// 从已解码图像直接合成，避免重复解码（候选图常有 1600 万像素，解码很贵）。
export function renderCandidateSheet(image) {
  const overview = fitWidth(image, SHEET_WIDTH);
  // 曝光两联只需要半宽，把像素预算让给局部放大。
  const halfWidth = Math.floor(SHEET_WIDTH / 2);
  const small = fitWidth(image, halfWidth);
  const lifted = adjustGamma(small, 0.45);
  const pulled = adjustGamma(small, 1.9);
  const tileBoxW = Math.floor(SHEET_WIDTH / TILE_COLS);
  const quadW = Math.floor(image.width / TILE_COLS);
  const quadH = Math.floor(image.height / TILE_ROWS);
  // 局部放大倍率控制在 2.5x 以内：再大就会糊掉文字和手部细节，再小则看不出畸形。
  const cropSide = Math.max(64, Math.min(quadW, quadH, Math.round(tileBoxW * 2.5)));

  const bandHeights = [overview.height, lifted.height, tileBoxW * TILE_ROWS];
  const total = bandHeights.reduce((a, b) => a + b, 0) + SEPARATOR * 2;
  const canvas = createCanvas(SHEET_WIDTH, total, 3);

  let y = 0;
  drawImage(canvas, overview, 0, y, SHEET_WIDTH, overview.height);
  drawLabel(canvas, '1', 0, y);
  y += overview.height;
  fillBand(canvas, y, SEPARATOR);
  y += SEPARATOR;

  drawImage(canvas, lifted, 0, y, halfWidth, lifted.height);
  drawLabel(canvas, '2', 0, y);
  drawImage(canvas, pulled, halfWidth, y, halfWidth, pulled.height);
  drawLabel(canvas, '3', halfWidth, y);
  y += lifted.height;
  fillBand(canvas, y, SEPARATOR);
  y += SEPARATOR;

  for (let row = 0; row < TILE_ROWS; row += 1) {
    for (let col = 0; col < TILE_COLS; col += 1) {
      const cx = col * quadW + Math.floor((quadW - cropSide) / 2);
      const cy = row * quadH + Math.floor((quadH - cropSide) / 2);
      const tile = crop(image, cx, cy, cropSide, cropSide);
      const dx = col * tileBoxW;
      const dy = y + row * tileBoxW;
      drawImage(canvas, tile, dx, dy, tileBoxW, tileBoxW);
      drawLabel(canvas, String(4 + row * TILE_COLS + col), dx, dy);
    }
  }
  return canvas;
}

export async function buildCandidateSheet(imagePath, outPath) {
  const image = decodeImage(await readFile(imagePath));
  const canvas = renderCandidateSheet(image);
  await writeImage(outPath, canvas);
  return { sheet: outPath, width: image.width, height: image.height, layout: CANDIDATE_SHEET_LAYOUT };
}

// 批量生成，entries: [{ id, path }]，返回 Map(id -> sheetPath)。并发解码，失败的单张跳过。
export async function buildCandidateSheets(entries, outDir) {
  await mkdir(outDir, { recursive: true });
  const results = await Promise.all(
    entries.map(async (entry) => {
      try {
        const out = join2(outDir, entry.id + '-sheet.png');
        const info = await buildCandidateSheet(entry.path, out);
        return { id: entry.id, sheet: info.sheet };
      } catch (error) {
        return { id: entry.id, error: String(error && error.message ? error.message : error) };
      }
    }),
  );
  const map = new Map();
  for (const item of results) if (item.sheet) map.set(item.id, item.sheet);
  return map;
}

// ---------------------------------------------------------------- 参考图 / 并排对比

// 把多张图拼成一张带编号的对比图。labels 决定左上角标签文字。
export async function buildGridSheet(items, outPath, options) {
  const width = (options && options.width) || SHEET_WIDTH;
  const perRow = Math.min(items.length, (options && options.perRow) || 4);
  const rows = Math.ceil(items.length / perRow);
  const cellW = Math.floor(width / perRow);
  const cellH = cellW;
  const canvas = createCanvas(width, cellH * rows, 3);
  const used = [];
  for (let index = 0; index < items.length; index += 1) {
    let image;
    try {
      image = decodeImage(await readFile(items[index].path));
    } catch {
      continue;
    }
    const box = fitBox(image.width, image.height, cellW, cellH);
    const col = index % perRow;
    const row = Math.floor(index / perRow);
    const dx = col * cellW + Math.floor((cellW - box.w) / 2);
    const dy = row * cellH + Math.floor((cellH - box.h) / 2);
    drawImage(canvas, image, dx, dy, box.w, box.h);
    const label = items[index].label || String(index + 1);
    drawLabel(canvas, label, col * cellW, row * cellH);
    used.push({ label, path: items[index].path, width: image.width, height: image.height });
  }
  await writeImage(outPath, canvas);
  return { sheet: outPath, items: used };
}

export async function buildReferenceSheet(refs, outPath) {
  const items = refs.map((ref, index) => ({ path: ref.path || ref, label: ref.id || String(index + 1) }));
  const result = await buildGridSheet(items, outPath, { perRow: 4 });
  if (!result.items.length) return null;
  return result;
}

// ---------------------------------------------------------------- 程序测量

export async function imageStats(imagePath) {
  const image = decodeImage(await readFile(imagePath));
  const stats = analyze(image);
  return {
    file: imagePath,
    width: image.width,
    height: image.height,
    aspectRatio: round(image.width / image.height, 4),
    longEdge: Math.max(image.width, image.height),
    stats,
    drift: detectDrift(stats, null),
    histogram: histogram(image),
  };
}

export async function compareImages(imagePath, parentPath) {
  const current = decodeImage(await readFile(imagePath));
  const parent = decodeImage(await readFile(parentPath));
  const currentStats = analyze(current);
  const parentStats = analyze(parent);
  return {
    current: currentStats,
    parent: parentStats,
    drift: detectDrift(currentStats, parentStats),
    sharpness: detectOverSharpen(currentStats, parentStats),
    meanAbsDiff: round(meanAbsDiff(current, parent), 3),
  };
}

// ---------------------------------------------------------------- 内部工具

async function writeImage(outPath, canvas) {
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, encodePng(canvas, { level: 3 }));
}

function fitWidth(image, width) {
  if (image.width <= width) return image;
  return downsample(image, width);
}

export function fitBox(srcW, srcH, boxW, boxH) {
  const scale = Math.min(boxW / srcW, boxH / srcH);
  return { w: Math.max(1, Math.round(srcW * scale)), h: Math.max(1, Math.round(srcH * scale)) };
}

function fillBand(canvas, y, height) {
  for (let row = y; row < Math.min(canvas.height, y + height); row += 1) {
    canvas.data.fill(96, row * canvas.width * canvas.channels, (row + 1) * canvas.width * canvas.channels);
  }
}

const DIGITS = {
  0: ['111', '101', '101', '101', '111'],
  1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'],
  5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'],
  7: ['111', '001', '001', '001', '001'],
  8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
  R: ['111', '101', '111', '110', '101'],
};

// 在 (x, y) 处画一个黑底白字的编号标签，让材料图自解释，评审可以直接说"第 5 块"。
function drawLabel(canvas, text, x, y) {
  const scale = LABEL_SCALE;
  const glyphW = 3 * scale;
  const glyphH = 5 * scale;
  const pad = scale;
  const chars = String(text).split('');
  const boxW = chars.length * (glyphW + scale) - scale + pad * 2;
  const boxH = glyphH + pad * 2;
  for (let row = y; row < Math.min(canvas.height, y + boxH); row += 1) {
    for (let col = x; col < Math.min(canvas.width, x + boxW); col += 1) {
      const di = (row * canvas.width + col) * canvas.channels;
      canvas.data[di] = 17;
      canvas.data[di + 1] = 17;
      canvas.data[di + 2] = 17;
    }
  }
  chars.forEach((char, index) => {
    const glyph = DIGITS[char] || DIGITS[Number(char)];
    if (!glyph) return;
    const ox = x + pad + index * (glyphW + scale);
    const oy = y + pad;
    for (let gy = 0; gy < 5; gy += 1) {
      for (let gx = 0; gx < 3; gx += 1) {
        if (glyph[gy][gx] !== '1') continue;
        for (let py = 0; py < scale; py += 1) {
          for (let px = 0; px < scale; px += 1) {
            const cx = ox + gx * scale + px;
            const cy = oy + gy * scale + py;
            if (cx >= canvas.width || cy >= canvas.height) continue;
            const di = (cy * canvas.width + cx) * canvas.channels;
            canvas.data[di] = 255;
            canvas.data[di + 1] = 255;
            canvas.data[di + 2] = 255;
          }
        }
      }
    }
  });
}

function crop(image, x, y, width, height) {
  const out = Buffer.alloc(width * height * image.channels);
  for (let row = 0; row < height; row += 1) {
    const sy = Math.min(image.height - 1, y + row);
    const src = (sy * image.width + x) * image.channels;
    image.data.copy(out, row * width * image.channels, src, src + width * image.channels);
  }
  return { width, height, channels: image.channels, data: out };
}

function histogram(image) {
  const buckets = new Array(8).fill(0);
  const { channels, data } = image;
  const step = Math.max(1, Math.floor((image.width * image.height) / 200000));
  let count = 0;
  for (let p = 0; p < image.width * image.height; p += step) {
    const i = p * channels;
    const luma = 0.2126 * data[i] + 0.7152 * data[i + Math.min(1, channels - 1)] + 0.0722 * data[i + Math.min(2, channels - 1)];
    buckets[Math.min(7, Math.floor(luma / 32))] += 1;
    count += 1;
  }
  return buckets.map((value) => round(value / count, 4));
}

function meanAbsDiff(a, b) {
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const step = Math.max(1, Math.floor((width * height) / 100000));
  let sum = 0;
  let count = 0;
  for (let p = 0; p < width * height; p += step) {
    const y = Math.floor(p / width);
    const x = p % width;
    const ai = (Math.floor((y / height) * a.height) * a.width + Math.floor((x / width) * a.width)) * a.channels;
    const bi = (Math.floor((y / height) * b.height) * b.width + Math.floor((x / width) * b.width)) * b.channels;
    sum += Math.abs(a.data[ai] - b.data[bi]);
    count += 1;
  }
  return count ? sum / count : 0;
}

function round(value, digits) {
  const p = Math.pow(10, digits);
  return Math.round(value * p) / p;
}

function join2(dir, name) {
  return dir.endsWith('/') ? dir + name : dir + '/' + name;
}
