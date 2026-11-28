// 二维码修复：找到生图模型画的「假码」，生成真码贴回同一位置，再从最终像素里把它扫回来。
//
// 为什么要有这一步：生图模型画不出能扫的二维码，它画的只是「长得像二维码」的黑白方块
// （真机 20261111-606a7e：两张候选的码 jsQR 一个都扫不出，评审只核对了「像不像二维码」就放行）。
// 所以图里要放二维码时，由程序生成真码（qrcode.mjs），贴回模型画的位置，再扫码验证。
//
// 步骤：
// 1. 定位：先让 jsQR 扫一遍（图里已经有能扫的码就直接用它的四角）；扫不出的，
//    自己找三个角的回字形定位方块（1:1:3:1:1 的黑白比例），挑出能拼成直角等腰三角形的三个。
// 2. 求四角：沿三个定位方块的外边缘取点、拟合四条边线，边线相交得到透视四角；
//    拟合不出来时退回按三个定位方块推出的平行四边形。
// 3. 取光照：在码区和四周留白里取样，按亮度分成浅色、深色两组，各拟合一张二次曲面，
//    贴上去的真码跟着原来的明暗走（上亮下暗、偏色、阴影都保留）。
// 4. 贴码：把假码连同一圈边缘抹成浅色，按透视把真码的每个模块画进去，边缘抗锯齿、外圈羽化。
// 5. 验证：只认扫码结果，而且只认最终文件：按原格式编码成 JPEG/PNG，再从这份字节重新解码，
//    在三种裁切范围下各扫「近看」（原分辨率）和「远看」（缩到每个模块约 2 像素）一次，
//    近看、远看都至少两次解出要放的内容才算通过，任何一次解出别的内容直接判不通过。
//    多看几次是因为 jsQR 对裁切范围敏感：同一枚码换个边距就可能扫不出（实测过），
//    只扫一次会把好码误判成坏码；而要求「多数视角都扫得出」才算稳。
import { encodeQr } from './qrcode.mjs';
import { scanQr, scanAllQr } from './qrscan.mjs';
import { decodeImage, sniffFormat } from './image.mjs';
import { encodePng } from './png.mjs';
import { encodeJpeg } from './jpegenc.mjs';

// 找定位方块时用的工作分辨率（长边）。4K 原图直接扫太慢，2048 下一个模块仍有 3 像素以上，
// 前提是码的边长不小于原图长边的约 1/25。
const WORK_EDGE = 2048;
// 贴回去之后每个模块至少要占这么多像素，再小就算扫得出也是碰运气。
export const MIN_MODULE_PX = 4;
// 真码四周要留的静区（模块数）。标准要求 4；原图白边不够时把码缩小一点、从码区里让出来，
// 3 是实测在深色底上也扫得稳的下限（2 模块时 jsQR 换几个边距就有扫不出的）。
const QUIET_MODULES = 3;
// 编码最终 JPEG 的质量。原图本身就是 JPEG，再压一次用高质量，肉眼看不出二次压缩。
const JPEG_QUALITY = 93;

export const QR_REASONS = {
  not_found: '没在图里找到二维码（找不到三个角的定位方块）',
  too_small: '图里的二维码太小，装不下这段内容',
  unscannable: '贴上真码后扫不出来',
  mismatch: '贴上真码后扫出来的内容不对',
  encode_failed: '内容太长，生成不了二维码',
};

// 让出事件循环：解码、编码 4K 图各要一两秒，连着跑会让面板的轮询请求排队，看起来像卡死。
const tick = () => new Promise((resolve) => setImmediate(resolve));

// ---------------------------------------------------------------- 对外入口

// 在一张已解码的图上把码贴好（不验证，验证在 fixQrInImage 里对最终字节做）。contents：要放的内容，
// 一条时对应图里最大的那枚码，多条时按从上到下、从左到右对应。
// 返回 { image, changed, results }，results 每项对应 contents 里的一条。
export function fixQrCodes(image, contents, options) {
  const opts = options || {};
  const wanted = (Array.isArray(contents) ? contents : [contents]).map((item) => String(item || '')).filter(Boolean);
  const results = [];
  if (!wanted.length) return { image, changed: false, results, regions: [] };
  const regions = locateQrCodes(image, { max: Math.max(4, wanted.length + 2) });
  const assigned = assignRegions(regions, wanted.length);
  let out = image;
  let changed = false;
  for (let index = 0; index < wanted.length; index += 1) {
    const content = wanted[index];
    const region = assigned[index];
    if (!region) {
      results.push(failure(content, 'not_found'));
      continue;
    }
    if (region.decoded !== null && region.decoded === content) {
      // 图里本来就是一枚能扫、内容也对的码（比如上一轮已经贴过），不再动它，交给 finishQr 照样验一遍。
      results.push({
        content,
        ok: true,
        changed: false,
        reason: '',
        reasonText: '',
        version: region.version || 0,
        ecl: '',
        modules: region.version ? region.version * 4 + 17 : 0,
        modulePx: round2(region.modulePx),
        corners: roundCorners(region.corners),
        eraseCorners: roundCorners(region.corners),
        scanned: content,
        source: region.source,
      });
      continue;
    }
    if (out === image) out = { ...image, data: Buffer.from(image.data) };
    const pasted = pasteQr(out, region, content, opts);
    if (!pasted.ok) {
      results.push({ ...failure(content, pasted.reason), detail: pasted.detail || '', source: region.source });
      continue;
    }
    changed = true;
    results.push({
      content,
      ok: true,
      changed: true,
      reason: '',
      reasonText: '',
      version: pasted.qr.version,
      ecl: pasted.qr.ecl,
      modules: pasted.qr.size,
      modulePx: round2(pasted.modulePx),
      corners: roundCorners(pasted.codeCorners),
      eraseCorners: roundCorners(pasted.eraseCorners),
      scanned: null,
      source: region.source,
    });
  }
  return { image: out, changed, results, regions };
}

// 已解码的图进、最终字节出：贴码 → 按原格式编码 → 从编码后的字节重新解码 → 逐枚扫码验证。
// format 是原图格式（'png' 时输出 PNG，其余一律 JPEG）。没有任何一枚码需要改时不重新编码，
// 但照样在原图上验一遍，返回的 buffer 为 null，表示「沿用原文件」。
export async function fixQrInImage(image, format, contents, options) {
  const fixed = fixQrCodes(image, contents, options);
  await tick();
  let decoded = image;
  let buffer = null;
  let outFormat = format;
  const pending = fixed.results.filter((item) => item.ok);
  if (fixed.changed && pending.length) {
    outFormat = format === 'png' ? 'png' : 'jpeg';
    buffer = outFormat === 'png' ? encodePng(fixed.image, { level: 6 }) : encodeJpeg(fixed.image, { quality: JPEG_QUALITY });
    await tick();
    decoded = decodeImage(buffer);
    await tick();
  }
  for (const result of pending) {
    const check = verifyPasted(decoded, result, result.content);
    result.ok = check.ok;
    result.scanned = check.scanned;
    result.scans = check.scans;
    result.reason = check.ok ? '' : check.reason;
    result.reasonText = check.ok ? '' : QR_REASONS[check.reason];
    result.verifiedOn = buffer ? outFormat : 'original';
  }
  const ok = allOk(fixed.results);
  // 有一枚没过就不交出新文件：贴了一半的图既不是原图也不是可用的图。
  if (!ok) return { buffer: null, format, decoded: image, changed: false, results: fixed.results, ok };
  return { buffer, format: outFormat, decoded, changed: Boolean(buffer), results: fixed.results, ok };
}

// 字节进、字节出，给命令行用。
export async function fixQrInBuffer(buffer, contents, options) {
  const format = sniffFormat(buffer);
  const image = decodeImage(buffer);
  await tick();
  const result = await fixQrInImage(image, format, contents, options);
  return { ...result, buffer: result.buffer || buffer };
}

function allOk(results) {
  return results.length > 0 && results.every((item) => item.ok);
}

function failure(content, reason) {
  return {
    content,
    ok: false,
    changed: false,
    reason,
    reasonText: QR_REASONS[reason] || reason,
    version: 0,
    ecl: '',
    modules: 0,
    modulePx: 0,
    corners: null,
    scanned: null,
  };
}

// ---------------------------------------------------------------- 定位

// 找图里所有二维码（能扫的、扫不出的都算）。返回 [{ corners: [左上, 右上, 右下, 左下], modulePx,
// modules, decoded, version, quiet, source }]，按面积从大到小。
export function locateQrCodes(image, options) {
  const opts = options || {};
  const max = Math.max(1, Math.min(8, opts.max || 4));
  const regions = [];

  // 先扫能扫的码：jsQR 给的四角就是码的外边界，比自己拟合准。
  // 只认正色（深色码印在浅底上）：反色码多数手机扫不了，验证也只按正色扫。
  const work = Math.min(1, 1600 / Math.max(image.width, image.height));
  for (const hit of scanAllQr(image, { max, maxEdge: work < 1 ? 1600 : undefined, invert: false })) {
    const side = quadSide(hit.corners);
    const modules = hit.version * 4 + 17;
    regions.push({
      corners: hit.corners,
      modulePx: side / modules,
      modules,
      decoded: hit.data,
      version: hit.version,
      source: 'decoded',
    });
  }

  const gray = toGray(image, WORK_EDGE);
  const binary = binarize(gray);
  let triples = pickTriples(findFinderCandidates(binary, gray.width, gray.height, false), binary, gray.width, gray.height, max);
  // 一组都没找到时再按「四周没有白边」放宽找一遍。放宽会多出不少误报，所以只在严格找不到时用。
  if (!triples.length && !regions.length) {
    triples = pickTriples(findFinderCandidates(binary, gray.width, gray.height, true), binary, gray.width, gray.height, max);
  }
  for (const triple of triples) {
    const region = refineRegion(image, triple, gray.scale);
    if (!region) continue;
    // 和已经扫出来的码重合的，以扫出来的为准。
    if (regions.some((other) => overlap(other.corners, region.corners) > 0.3)) continue;
    regions.push({ ...region, decoded: null, version: 0, source: 'finder' });
  }
  for (const region of regions) region.quiet = measureQuiet(image, region);
  return regions.sort((a, b) => quadArea(b.corners) - quadArea(a.corners)).slice(0, max);
}

// 一条内容时取最大的那枚码；多条时按从上到下、从左到右对应。
function assignRegions(regions, count) {
  if (!regions.length) return [];
  if (count === 1) return [regions[0]];
  const picked = regions.slice(0, count);
  const rowTolerance = Math.max(...picked.map((region) => quadSide(region.corners))) * 0.5;
  return picked.sort((a, b) => {
    const ca = center(a.corners);
    const cb = center(b.corners);
    if (Math.abs(ca.y - cb.y) > rowTolerance) return ca.y - cb.y;
    return ca.x - cb.x;
  });
}

// 缩成灰度工作图（盒式滤波，细小模块不会被漏掉）。
function toGray(image, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const { channels, data } = image;
  const out = new Uint8Array(width * height);
  const sx = image.width / width;
  const sy = image.height / height;
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.min(image.height, Math.floor((y + 1) * sy)));
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.min(image.width, Math.floor((x + 1) * sx)));
      let sum = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy += 1) {
        let i = (yy * image.width + x0) * channels;
        for (let xx = x0; xx < x1; xx += 1, i += channels) {
          sum += channels >= 3 ? (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8 : data[i];
          n += 1;
        }
      }
      out[y * width + x] = sum / n;
    }
  }
  return { width, height, data: out, scale: width / image.width };
}

// Sauvola 局部阈值：平坦区域（均匀的深色背景、纯白底）不会被噪点切成碎块，
// 高对比区域阈值贴近局部均值。返回 1 = 深色。
function binarize(gray) {
  const { width, height, data } = gray;
  const stride = width + 1;
  const sum = new Float64Array(stride * (height + 1));
  const sq = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    let rowSq = 0;
    for (let x = 0; x < width; x += 1) {
      const v = data[y * width + x];
      rowSum += v;
      rowSq += v * v;
      sum[(y + 1) * stride + x + 1] = sum[y * stride + x + 1] + rowSum;
      sq[(y + 1) * stride + x + 1] = sq[y * stride + x + 1] + rowSq;
    }
  }
  const radius = Math.max(8, Math.round(Math.min(width, height) / 16));
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width, x + radius + 1);
      const n = (x1 - x0) * (y1 - y0);
      const s = sum[y1 * stride + x1] - sum[y0 * stride + x1] - sum[y1 * stride + x0] + sum[y0 * stride + x0];
      const q = sq[y1 * stride + x1] - sq[y0 * stride + x1] - sq[y1 * stride + x0] + sq[y0 * stride + x0];
      const mean = s / n;
      const std = Math.sqrt(Math.max(0, q / n - mean * mean));
      const threshold = mean * (1 + 0.25 * (std / 128 - 1));
      out[y * width + x] = data[y * width + x] < threshold ? 1 : 0;
    }
  }
  return out;
}

// 1:1:3:1:1 的比例判定。模型画的定位方块比例不准，容差比标准解码器放宽一些。
// relaxed：码直接画在深色底上、四周没有白边时，最外圈黑框会和背景连成一片，
// 这时只要求最外两段「至少有半个模块宽」，模块大小改由中间三段推算。
function finderRatio(runs, relaxed) {
  for (const run of runs) if (!run) return 0;
  const module = relaxed ? (runs[1] + runs[2] + runs[3]) / 5 : runs.reduce((a, b) => a + b, 0) / 7;
  if (module < 1) return 0;
  const variance = module * 0.6;
  const outer = relaxed
    ? runs[0] > module * 0.5 && runs[4] > module * 0.5
    : Math.abs(runs[0] - module) < variance && Math.abs(runs[4] - module) < variance;
  const ok =
    outer &&
    Math.abs(runs[1] - module) < variance &&
    Math.abs(runs[2] - 3 * module) < 3 * variance &&
    Math.abs(runs[3] - module) < variance;
  return ok ? module : 0;
}

// 沿一条直线（行、列）从中心往两边数黑白段，返回 [外黑, 白, 中心黑, 白, 外黑] 与中心坐标。
function crossCheck(binary, width, height, cx, cy, dx, dy, maxRun, relaxed) {
  const at = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? -1 : binary[y * width + x]);
  if (at(cx, cy) !== 1) return null;
  const runs = [0, 0, 0, 0, 0];
  let x = cx;
  let y = cy;
  while (at(x, y) === 1 && runs[2] <= maxRun) { runs[2] += 1; x -= dx; y -= dy; }
  while (at(x, y) === 0 && runs[1] <= maxRun) { runs[1] += 1; x -= dx; y -= dy; }
  while (at(x, y) === 1 && runs[0] <= maxRun) { runs[0] += 1; x -= dx; y -= dy; }
  const back = runs[2];
  x = cx + dx;
  y = cy + dy;
  while (at(x, y) === 1 && runs[2] <= maxRun * 2) { runs[2] += 1; x += dx; y += dy; }
  while (at(x, y) === 0 && runs[3] <= maxRun) { runs[3] += 1; x += dx; y += dy; }
  while (at(x, y) === 1 && runs[4] <= maxRun) { runs[4] += 1; x += dx; y += dy; }
  const module = finderRatio(runs, relaxed);
  if (!module) return null;
  // 中心黑段的中点：往回走了 back-1 步，往前走了 runs[2]-back 步。
  const offset = (runs[2] - back - (back - 1)) / 2;
  const total = relaxed ? module * 7 : runs.reduce((a, b) => a + b, 0);
  return { module, total, cx: cx + dx * offset, cy: cy + dy * offset };
}

function findFinderCandidates(binary, width, height, relaxed) {
  const found = [];
  const runs = [];
  for (let y = 0; y < height; y += 1) {
    // 先把这一行切成黑白段。
    runs.length = 0;
    let start = 0;
    for (let x = 1; x <= width; x += 1) {
      if (x === width || binary[y * width + x] !== binary[y * width + start]) {
        runs.push({ color: binary[y * width + start], start, length: x - start });
        start = x;
      }
    }
    for (let i = 0; i + 4 < runs.length; i += 1) {
      if (runs[i].color !== 1) continue;
      const lengths = [runs[i].length, runs[i + 1].length, runs[i + 2].length, runs[i + 3].length, runs[i + 4].length];
      const module = finderRatio(lengths, relaxed);
      if (!module) continue;
      const cx = Math.round(runs[i + 2].start + runs[i + 2].length / 2);
      const total = module * 7;
      const vertical = crossCheck(binary, width, height, cx, y, 0, 1, Math.ceil(total), relaxed);
      if (!vertical) continue;
      // 竖向和横向的模块大小要对得上（透视下允许差一些）。
      const ratio = vertical.module / module;
      if (ratio < 0.55 || ratio > 1.8) continue;
      const horizontal = crossCheck(binary, width, height, cx, Math.round(vertical.cy), 1, 0, Math.ceil(total), relaxed);
      if (!horizontal) continue;
      // 对角线再核一次：文字里的「回」「口」这类字横竖都像定位方块，斜着看就不像了。
      const diagonal = crossCheck(binary, width, height, Math.round(horizontal.cx), Math.round(vertical.cy), 1, 1, Math.ceil(total * 1.5), relaxed);
      if (!diagonal) continue;
      addCandidate(found, horizontal.cx, vertical.cy, (horizontal.module + vertical.module) / 2);
    }
  }
  return found.filter((item) => item.count >= 2).sort((a, b) => b.count - a.count).slice(0, 40);
}

function addCandidate(list, x, y, module) {
  for (const item of list) {
    if (Math.abs(item.x - x) < item.module * 2.5 && Math.abs(item.y - y) < item.module * 2.5) {
      const ratio = module / item.module;
      if (ratio < 0.5 || ratio > 2) continue;
      const n = item.count;
      item.x = (item.x * n + x) / (n + 1);
      item.y = (item.y * n + y) / (n + 1);
      item.module = (item.module * n + module) / (n + 1);
      item.count = n + 1;
      return;
    }
  }
  list.push({ x, y, module, count: 1 });
}

// 从定位方块候选里挑出能组成二维码的三个：直角、两条腰差不多长、模块大小一致、
// 中间区域黑白交错（二维码的数据区）。挑完一组就把用掉的候选去掉，接着找下一枚码。
function pickTriples(candidates, binary, width, height, max) {
  const pool = candidates.slice(0, 30);
  const out = [];
  const used = new Set();
  while (out.length < max) {
    let best = null;
    for (let i = 0; i < pool.length; i += 1) {
      if (used.has(i)) continue;
      for (let j = i + 1; j < pool.length; j += 1) {
        if (used.has(j)) continue;
        for (let k = j + 1; k < pool.length; k += 1) {
          if (used.has(k)) continue;
          const triple = orderTriple(pool[i], pool[j], pool[k]);
          if (!triple) continue;
          if (!best || triple.score < best.score) best = { ...triple, ids: [i, j, k] };
        }
      }
    }
    if (!best) break;
    for (const id of best.ids) used.add(id);
    if (!looksLikeData(best, binary, width, height)) continue;
    // 落在这枚码里面的其它候选（数据区里偶然像定位方块的图案）也一并去掉。
    const corners = affineCorners(best);
    pool.forEach((item, index) => {
      if (!used.has(index) && pointInQuad(item, corners)) used.add(index);
    });
    out.push(best);
  }
  return out;
}

function orderTriple(a, b, c) {
  const modules = [a.module, b.module, c.module];
  const spread = Math.max(...modules) / Math.min(...modules);
  if (spread > 1.7) return null;
  const dab = dist(a, b);
  const dac = dist(a, c);
  const dbc = dist(b, c);
  let corner;
  let p;
  let q;
  if (dbc >= dab && dbc >= dac) [corner, p, q] = [a, b, c];
  else if (dac >= dab && dac >= dbc) [corner, p, q] = [b, a, c];
  else [corner, p, q] = [c, a, b];
  const legA = dist(corner, p);
  const legB = dist(corner, q);
  const legRatio = Math.min(legA, legB) / Math.max(legA, legB);
  if (legRatio < 0.7) return null;
  const cos = ((p.x - corner.x) * (q.x - corner.x) + (p.y - corner.y) * (q.y - corner.y)) / (legA * legB);
  if (Math.abs(cos) > 0.35) return null;
  const module = (a.module + b.module + c.module) / 3;
  const span = (legA + legB) / 2 / module;
  // 版本 1 的定位方块中心相距 14 个模块；模型画的码模块数不准，下限放宽到 8。
  if (span < 8 || span > 200) return null;
  const cross = (p.x - corner.x) * (q.y - corner.y) - (p.y - corner.y) * (q.x - corner.x);
  const [topRight, bottomLeft] = cross > 0 ? [p, q] : [q, p];
  const score = Math.abs(cos) * 2 + (1 - legRatio) * 2 + (spread - 1) - Math.log(a.count + b.count + c.count) * 0.05;
  return { topLeft: corner, topRight, bottomLeft, module, span, score };
}

// 数据区抽样：深色占比要在 15%-85% 之间，相邻模块之间要有足够的黑白翻转。
// 一块空白、一个实心方块、一段文字都过不了这一关。
function looksLikeData(triple, binary, width, height) {
  const { topLeft, topRight, bottomLeft, span } = triple;
  const n = span + 7;
  const ux = { x: (topRight.x - topLeft.x) / span, y: (topRight.y - topLeft.y) / span };
  const vy = { x: (bottomLeft.x - topLeft.x) / span, y: (bottomLeft.y - topLeft.y) / span };
  const origin = { x: topLeft.x - 3.5 * ux.x - 3.5 * vy.x, y: topLeft.y - 3.5 * ux.y - 3.5 * vy.y };
  let dark = 0;
  let total = 0;
  let flips = 0;
  let pairs = 0;
  const steps = Math.max(9, Math.min(60, Math.round(n)));
  for (let row = 0; row < steps; row += 1) {
    const v = 8 + ((n - 9) * (row + 0.5)) / steps;
    let last = -1;
    for (let col = 0; col < steps; col += 1) {
      const u = 8 + ((n - 9) * (col + 0.5)) / steps;
      // 跳过右下角以外的三个定位方块区域，只看数据区。
      const x = Math.round(origin.x + u * ux.x + v * vy.x);
      const y = Math.round(origin.y + u * ux.y + v * vy.y);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const bit = binary[y * width + x];
      dark += bit;
      total += 1;
      if (last >= 0) {
        pairs += 1;
        if (bit !== last) flips += 1;
      }
      last = bit;
    }
  }
  if (total < 20 || pairs < 10) return false;
  const ratio = dark / total;
  return ratio > 0.15 && ratio < 0.85 && flips / pairs > 0.15;
}

function affineCorners(triple) {
  const { topLeft, topRight, bottomLeft, span } = triple;
  const ux = { x: (topRight.x - topLeft.x) / span, y: (topRight.y - topLeft.y) / span };
  const vy = { x: (bottomLeft.x - topLeft.x) / span, y: (bottomLeft.y - topLeft.y) / span };
  const at = (u, v) => ({ x: topLeft.x + (u - 3.5) * ux.x + (v - 3.5) * vy.x, y: topLeft.y + (u - 3.5) * ux.y + (v - 3.5) * vy.y });
  const n = span + 7;
  return [at(0, 0), at(n, 0), at(n, n), at(0, n)];
}

// 在原图分辨率上沿定位方块外边缘取点、拟合四条边线，交出透视四角。
function refineRegion(image, triple, scale) {
  const back = (p) => ({ x: (p.x + 0.5) / scale - 0.5, y: (p.y + 0.5) / scale - 0.5 });
  const tl = back(triple.topLeft);
  const tr = back(triple.topRight);
  const bl = back(triple.bottomLeft);
  const span = triple.span;
  const module = triple.module / scale;
  const u = norm({ x: tr.x - tl.x, y: tr.y - tl.y });
  const v = norm({ x: bl.x - tl.x, y: bl.y - tl.y });
  const gray = (x, y) => sampleGray(image, x, y);

  const edge = (c, along, out) => {
    // 在定位方块的外黑框（中心外 2.5-3.5 模块）和外面的白边之间找黑白分界。
    const darkLevel = median([-1.5, 0, 1.5].map((s) => gray(c.x + along.x * s * module + out.x * 3 * module, c.y + along.y * s * module + out.y * 3 * module)));
    const lightLevel = median([-1.5, 0, 1.5].map((s) => gray(c.x + along.x * s * module + out.x * 4.1 * module, c.y + along.y * s * module + out.y * 4.1 * module)));
    if (lightLevel - darkLevel < 25) return [];
    const threshold = (darkLevel + lightLevel) / 2;
    const points = [];
    for (let s = -2.75; s <= 2.76; s += 0.5) {
      let prev = null;
      for (let k = 2.6; k <= 4.4; k += 0.05) {
        const x = c.x + along.x * s * module + out.x * k * module;
        const y = c.y + along.y * s * module + out.y * k * module;
        const g = gray(x, y);
        if (prev && prev.g < threshold && g >= threshold) {
          const t = (threshold - prev.g) / (g - prev.g || 1);
          points.push({ x: prev.x + (x - prev.x) * t, y: prev.y + (y - prev.y) * t });
          break;
        }
        prev = { x, y, g };
      }
    }
    return points;
  };

  const minus = (p) => ({ x: -p.x, y: -p.y });
  const top = fitLine([...edge(tl, u, minus(v)), ...edge(tr, u, minus(v))], module);
  const left = fitLine([...edge(tl, v, minus(u)), ...edge(bl, v, minus(u))], module);
  const right = fitLine(edge(tr, v, u), module);
  const bottom = fitLine(edge(bl, u, v), module);

  const affine = affineCorners({ topLeft: tl, topRight: tr, bottomLeft: bl, span });
  const tolerance = module * 1.5;
  const pick = (a, b, fallback) => {
    const hit = a && b ? intersect(a, b) : null;
    return hit && dist(hit, fallback) < tolerance ? hit : fallback;
  };
  const corners = [
    pick(top, left, affine[0]),
    pick(top, right, affine[1]),
    pick(right, bottom, affine[2]),
    pick(left, bottom, affine[3]),
  ];
  if (!isConvex(corners)) return { corners: affine, modulePx: module, modules: span + 7 };
  const side = quadSide(corners);
  return { corners, modulePx: module, modules: side / module };
}

// 四条边外面有多宽的浅色静区（按原码的模块数算）。贴码时外圈羽化和真码自己的静区都不能超出它。
function measureQuiet(image, region) {
  const [p0, p1, p2, p3] = region.corners;
  const h = squareToQuad(p0, p1, p2, p3);
  const n = Math.max(1, region.modules);
  // 先在码区里取一圈样本估计深浅分界。
  const samples = [];
  for (let i = 0; i < 24; i += 1) {
    for (let j = 0; j < 24; j += 1) {
      const p = applyH(h, (i + 0.5) / 24, (j + 0.5) / 24);
      samples.push(sampleGray(image, p.x, p.y));
    }
  }
  const threshold = otsu(samples);
  const sides = [
    (t, d) => [t, -d],
    (t, d) => [1 + d, t],
    (t, d) => [t, 1 + d],
    (t, d) => [-d, t],
  ];
  const widths = sides.map((side) => {
    let width = 0;
    for (let k = 1; k <= 24; k += 1) {
      const d = (k * 0.25) / n;
      let light = 0;
      let count = 0;
      for (let i = 0; i < 20; i += 1) {
        const [s, t] = side(0.05 + (0.9 * (i + 0.5)) / 20, d);
        const p = applyH(h, s, t);
        if (p.x < 0 || p.y < 0 || p.x >= image.width || p.y >= image.height) continue;
        count += 1;
        if (sampleGray(image, p.x, p.y) >= threshold) light += 1;
      }
      if (!count || light / count < 0.9) break;
      width = k * 0.25;
    }
    return width;
  });
  return { top: widths[0], right: widths[1], bottom: widths[2], left: widths[3], min: Math.min(...widths), threshold };
}

// ---------------------------------------------------------------- 贴码

export function pasteQr(image, region, content, options) {
  const opts = options || {};
  const fakeModules = Math.max(10, region.modules || 25);
  const sidePx = Math.min(...quadSides(region.corners));
  const quiet = region.quiet || measureQuiet(image, region);
  // 可用静区（归一化到码边长 = 1），最多算 4 个原码模块。
  const quietNorm = Math.min(4, quiet.min) / fakeModules;

  // 版本：先算装下内容的最小版本；再尽量贴近原图里码的密度（看起来不突兀，多出来的容量
  // 会让纠错等级顺势往上提），但最多比最小版本高 2 级——模块越细，离远了越难扫。
  let base;
  try {
    base = encodeQr(content, { ecl: opts.ecl || 'M', boostEcl: false });
  } catch {
    try {
      base = encodeQr(content, { ecl: 'L', boostEcl: false });
    } catch {
      return { ok: false, reason: 'encode_failed' };
    }
  }
  const fakeVersion = Math.max(1, Math.min(40, Math.round((fakeModules - 17) / 4)));
  const target = Math.min(Math.max(base.version, fakeVersion), base.version + 2);
  const options2 = [
    { ecl: base.ecl, minVersion: target },
    { ecl: base.ecl, minVersion: base.version },
    { ecl: 'L', minVersion: 1 },
  ];
  let qr = null;
  let layout = null;
  for (const option of options2) {
    let candidate;
    try {
      candidate = encodeQr(content, option);
    } catch {
      continue;
    }
    const candidateLayout = placeCode(candidate.size, quietNorm);
    if (!qr || candidateLayout.module > layout.module) {
      qr = candidate;
      layout = candidateLayout;
    }
    // 模块够大就用这一档，不再往下退。
    if (candidateLayout.module * sidePx >= MIN_MODULE_PX) {
      qr = candidate;
      layout = candidateLayout;
      break;
    }
  }
  if (!qr) return { ok: false, reason: 'encode_failed' };
  const modulePx = layout.module * sidePx;
  if (modulePx < MIN_MODULE_PX) {
    const need = Math.ceil(MIN_MODULE_PX / layout.module);
    return { ok: false, reason: 'too_small', detail: '码边长约 ' + Math.round(sidePx) + 'px，至少要 ' + need + 'px' };
  }

  const [p0, p1, p2, p3] = region.corners;
  const h = squareToQuad(p0, p1, p2, p3);
  const inv = invert3(h);
  // 抹除范围：原码外扩半个模块（边线拟合有误差，残留的假码边会干扰扫码），不超出原来的浅色静区。
  const erase = Math.min(0.5 / fakeModules, quietNorm * 0.6);
  const feather = Math.min(erase, 0.3 / fakeModules);
  const colors = sampleColors(image, h, quietNorm, fakeModules);

  const eraseCorners = [
    applyH(h, -erase, -erase),
    applyH(h, 1 + erase, -erase),
    applyH(h, 1 + erase, 1 + erase),
    applyH(h, -erase, 1 + erase),
  ];
  const minX = Math.max(0, Math.floor(Math.min(...eraseCorners.map((p) => p.x))) - 1);
  const maxX = Math.min(image.width - 1, Math.ceil(Math.max(...eraseCorners.map((p) => p.x))) + 1);
  const minY = Math.max(0, Math.floor(Math.min(...eraseCorners.map((p) => p.y))) - 1);
  const maxY = Math.min(image.height - 1, Math.ceil(Math.max(...eraseCorners.map((p) => p.y))) + 1);
  const { channels, data, width } = image;
  const size = qr.size;
  const modules = qr.modules;
  const unit = layout.module;
  const offset = layout.offset;
  const subs = [-1 / 3, 0, 1 / 3];
  const light = [0, 0, 0];
  const dark = [0, 0, 0];

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const c = applyH(inv, x + 0.5, y + 0.5);
      const edgeDist = Math.min(c.x + erase, 1 + erase - c.x, c.y + erase, 1 + erase - c.y);
      if (edgeDist < 0) continue;
      const alpha = feather > 0 ? Math.min(1, edgeDist / feather) : 1;
      // 3x3 超采样算模块覆盖率：用像素中心的雅可比近似子像素坐标，省掉 8 次透视反算。
      const cx = applyH(inv, x + 1.5, y + 0.5);
      const cy = applyH(inv, x + 0.5, y + 1.5);
      const dsx = cx.x - c.x;
      const dtx = cx.y - c.y;
      const dsy = cy.x - c.x;
      const dty = cy.y - c.y;
      let cover = 0;
      for (const oy of subs) {
        for (const ox of subs) {
          const s = c.x + dsx * ox + dsy * oy;
          const t = c.y + dtx * ox + dty * oy;
          const i = Math.floor((s - offset) / unit);
          const j = Math.floor((t - offset) / unit);
          if (i >= 0 && j >= 0 && i < size && j < size && modules[j * size + i] === 1) cover += 1;
        }
      }
      cover /= 9;
      colors.light(c.x, c.y, light);
      colors.dark(c.x, c.y, dark);
      const noise = colors.noise ? hashNoise(x, y) * colors.noise : 0;
      const o = (y * width + x) * channels;
      for (let k = 0; k < Math.min(3, channels); k += 1) {
        const value = light[k] * (1 - cover) + dark[k] * cover + noise;
        data[o + k] = clamp255(data[o + k] * (1 - alpha) + value * alpha);
      }
    }
  }
  const codeCorners = [
    applyH(h, offset, offset),
    applyH(h, offset + unit * size, offset),
    applyH(h, offset + unit * size, offset + unit * size),
    applyH(h, offset, offset + unit * size),
  ];
  return { ok: true, qr, modulePx, codeCorners, eraseCorners, layout };
}

// 真码在原码范围里怎么摆：静区够就铺满原码，不够就整体缩小、居中，把静区让出来。
function placeCode(size, quietNorm) {
  let module = 1 / size;
  if (QUIET_MODULES * module > quietNorm + 1e-9) module = (1 + 2 * quietNorm) / (size + 2 * QUIET_MODULES);
  module = Math.min(module, 1 / size);
  return { module, offset: (1 - size * module) / 2 };
}

// 浅色、深色各拟合一张二次曲面（每个通道 6 个系数），贴上去的码跟着原图的明暗与偏色走。
function sampleColors(image, h, quietNorm, fakeModules) {
  const grid = 40;
  const ring = Math.min(quietNorm, 1.5 / fakeModules);
  const points = [];
  for (let j = 0; j < grid; j += 1) {
    for (let i = 0; i < grid; i += 1) {
      const s = (i + 0.5) / grid;
      const t = (j + 0.5) / grid;
      points.push({ s, t, inside: true });
    }
  }
  if (ring > 0) {
    for (let i = 0; i < grid; i += 1) {
      const a = (i + 0.5) / grid;
      const d = ring * 0.6;
      points.push({ s: a, t: -d }, { s: a, t: 1 + d }, { s: -d, t: a }, { s: 1 + d, t: a });
    }
  }
  const rgb = [0, 0, 0];
  for (const point of points) {
    const p = applyH(h, point.s, point.t);
    sampleRgb(image, p.x, p.y, rgb);
    point.r = rgb[0];
    point.g = rgb[1];
    point.b = rgb[2];
    point.y = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  }
  const inside = points.filter((point) => point.inside);
  const threshold = otsu(inside.map((point) => point.y));
  const lightMean = mean(inside.filter((point) => point.y >= threshold).map((point) => point.y));
  const darkMean = mean(inside.filter((point) => point.y < threshold).map((point) => point.y));
  // 离分界太近的样本是模块边缘的过渡像素，不参与拟合。
  const lightCut = threshold + (lightMean - threshold) * 0.3;
  const darkCut = threshold - (threshold - darkMean) * 0.3;
  const lightSet = points.filter((point) => point.y >= lightCut && (point.inside || point.y >= threshold));
  const darkSet = inside.filter((point) => point.y <= darkCut);
  const lightFit = fitSurface(lightSet);
  let darkFit = fitSurface(darkSet);

  // 对比度兜底：模型画的码偶尔是灰对灰，扫码器需要深浅差足够大。
  const lc = evalSurface(lightFit, 0.5, 0.5);
  const dc = evalSurface(darkFit, 0.5, 0.5);
  const ly = 0.299 * lc[0] + 0.587 * lc[1] + 0.114 * lc[2];
  const dy = 0.299 * dc[0] + 0.587 * dc[1] + 0.114 * dc[2];
  if (dy > ly * 0.45) {
    const k = (ly * 0.45) / Math.max(1, dy);
    darkFit = darkFit.map((coef) => coef.map((value) => value * k));
  }
  // 原图浅色区域的颗粒感：加一点同幅度的噪声，贴上去的白底不会比周围「干净」得扎眼。
  let residual = 0;
  for (const point of lightSet) {
    const fit = evalSurface(lightFit, point.s, point.t);
    residual += (point.y - (0.299 * fit[0] + 0.587 * fit[1] + 0.114 * fit[2])) ** 2;
  }
  const noise = lightSet.length ? Math.min(4, Math.sqrt(residual / lightSet.length)) : 0;
  return {
    light: (s, t, out) => evalSurfaceInto(lightFit, s, t, out),
    dark: (s, t, out) => evalSurfaceInto(darkFit, s, t, out),
    noise,
    lightLuma: ly,
    darkLuma: Math.min(dy, ly * 0.45),
  };
}

function fitSurface(points) {
  const channels = ['r', 'g', 'b'];
  if (points.length < 24) {
    return channels.map((key) => [mean(points.map((point) => point[key])), 0, 0, 0, 0, 0]);
  }
  const ata = Array.from({ length: 6 }, () => new Array(6).fill(0));
  const atb = channels.map(() => new Array(6).fill(0));
  for (const point of points) {
    const basis = [1, point.s, point.t, point.s * point.s, point.s * point.t, point.t * point.t];
    for (let a = 0; a < 6; a += 1) {
      for (let b = 0; b < 6; b += 1) ata[a][b] += basis[a] * basis[b];
      channels.forEach((key, index) => {
        atb[index][a] += basis[a] * point[key];
      });
    }
  }
  return channels.map((key, index) => {
    const solved = solve6(ata, atb[index]);
    return solved || [mean(points.map((point) => point[key])), 0, 0, 0, 0, 0];
  });
}

function evalSurface(fit, s, t) {
  const out = [0, 0, 0];
  evalSurfaceInto(fit, s, t, out);
  return out;
}

function evalSurfaceInto(fit, s, t, out) {
  // 外推到静区以外时把坐标收回来，二次曲面在边界外会发散。
  const cs = s < -0.2 ? -0.2 : s > 1.2 ? 1.2 : s;
  const ct = t < -0.2 ? -0.2 : t > 1.2 ? 1.2 : t;
  for (let k = 0; k < 3; k += 1) {
    const c = fit[k];
    out[k] = c[0] + c[1] * cs + c[2] * ct + c[3] * cs * cs + c[4] * cs * ct + c[5] * ct * ct;
  }
  return out;
}

// 高斯消元解 6x6 正规方程；接近奇异时返回 null，调用方退回常数。
function solve6(matrix, vector) {
  const n = 6;
  const a = matrix.map((row, i) => [...row, vector[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-9) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const f = a[row][col] / a[col][col];
      for (let k = col; k <= n; k += 1) a[row][k] -= f * a[col][k];
    }
  }
  return a.map((row, i) => row[n] / row[i]);
}

// ---------------------------------------------------------------- 验证

// 扫码验证。三种边距（码边长的 12% / 30% / 60%）各扫两次：
// 「近看」按原分辨率（裁出来的图长边超过 1600 时缩到 1600，模块仍远大于扫码需要的像素），
// 「远看」缩到每个模块约 2.2 像素。近看、远看各至少 2 次解出 content 才算通过；
// 任何一次解出别的内容，判 mismatch。target 至少要带 eraseCorners（或 corners）和 modulePx。
export function verifyPasted(image, target, content) {
  const quad = target.eraseCorners || target.corners;
  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  const side = Math.max(box.w, box.h);
  const modulePx = Number(target.modulePx) || 0;
  const scans = [];
  for (const ratio of [0.12, 0.3, 0.6]) {
    const pad = side * ratio;
    const rect = { x: box.x - pad, y: box.y - pad, width: box.w + pad * 2, height: box.h + pad * 2 };
    const longEdge = Math.max(rect.width, rect.height);
    const near = scanQr(image, { rect, maxEdge: longEdge > 1600 ? 1600 : undefined });
    scans.push({ view: 'near', pad: ratio, data: near ? near.data : null });
    if (modulePx > 2.6) {
      const maxEdge = Math.max(64, Math.round((longEdge * 2.2) / modulePx));
      const far = scanQr(image, { rect, maxEdge });
      scans.push({ view: 'far', pad: ratio, data: far ? far.data : null });
    }
  }
  const wrong = scans.find((item) => item.data !== null && item.data !== content);
  const count = (view) => scans.filter((item) => item.view === view && item.data === content).length;
  const farViews = scans.filter((item) => item.view === 'far').length;
  const ok = !wrong && count('near') >= 2 && (farViews === 0 || count('far') >= 2);
  const scanned = wrong ? wrong.data : scans.some((item) => item.data === content) ? content : null;
  return { ok, scanned, scans, reason: ok ? '' : wrong ? 'mismatch' : 'unscannable' };
}

// ---------------------------------------------------------------- 几何与采样工具

function sampleGray(image, x, y) {
  const rgb = [0, 0, 0];
  sampleRgb(image, x, y, rgb);
  return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
}

// 双线性取色。坐标超出图片时贴边取。
function sampleRgb(image, x, y, out) {
  const { width, height, channels, data } = image;
  const fx = Math.max(0, Math.min(width - 1.001, x - 0.5));
  const fy = Math.max(0, Math.min(height - 1.001, y - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const ax = fx - x0;
  const ay = fy - y0;
  const i00 = (y0 * width + x0) * channels;
  const i10 = i00 + channels;
  const i01 = i00 + width * channels;
  const i11 = i01 + channels;
  for (let k = 0; k < 3; k += 1) {
    const c = channels >= 3 ? k : 0;
    const top = data[i00 + c] * (1 - ax) + data[i10 + c] * ax;
    const bottom = data[i01 + c] * (1 - ax) + data[i11 + c] * ax;
    out[k] = top * (1 - ay) + bottom * ay;
  }
  return out;
}

// 单位正方形 → 四边形的透视矩阵（Heckbert）。p0..p3 依次对应 (0,0) (1,0) (1,1) (0,1)。
export function squareToQuad(p0, p1, p2, p3) {
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    return [p1.x - p0.x, p3.x - p0.x, p0.x, p1.y - p0.y, p3.y - p0.y, p0.y, 0, 0, 1];
  }
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / den;
  const hh = (dx1 * dy3 - dx3 * dy1) / den;
  return [
    p1.x - p0.x + g * p1.x, p3.x - p0.x + hh * p3.x, p0.x,
    p1.y - p0.y + g * p1.y, p3.y - p0.y + hh * p3.y, p0.y,
    g, hh, 1,
  ];
}

export function applyH(m, s, t) {
  const w = m[6] * s + m[7] * t + m[8];
  return { x: (m[0] * s + m[1] * t + m[2]) / w, y: (m[3] * s + m[4] * t + m[5]) / w };
}

function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
}

// 总体最小二乘拟合直线，剔除离群点后再拟合一次。返回 { point, dir }。
function fitLine(points, module) {
  if (points.length < 3) return null;
  let line = pcaLine(points);
  for (let pass = 0; pass < 2 && line; pass += 1) {
    const kept = points.filter((p) => Math.abs(cross2(line.dir, { x: p.x - line.point.x, y: p.y - line.point.y })) < module * 0.35);
    if (kept.length < 3) return null;
    line = pcaLine(kept);
  }
  return line;
}

function pcaLine(points) {
  const mx = mean(points.map((p) => p.x));
  const my = mean(points.map((p) => p.y));
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { point: { x: mx, y: my }, dir: { x: Math.cos(angle), y: Math.sin(angle) } };
}

function intersect(a, b) {
  const den = cross2(a.dir, b.dir);
  if (Math.abs(den) < 0.2) return null;
  const diff = { x: b.point.x - a.point.x, y: b.point.y - a.point.y };
  const t = cross2(diff, b.dir) / den;
  return { x: a.point.x + a.dir.x * t, y: a.point.y + a.dir.y * t };
}

function cross2(a, b) {
  return a.x * b.y - a.y * b.x;
}

function norm(v) {
  const length = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / length, y: v.y / length };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function center(corners) {
  return { x: mean(corners.map((p) => p.x)), y: mean(corners.map((p) => p.y)) };
}

function quadSides(corners) {
  return corners.map((p, i) => dist(p, corners[(i + 1) % 4]));
}

function quadSide(corners) {
  return mean(quadSides(corners));
}

function quadArea(corners) {
  let area = 0;
  for (let i = 0; i < corners.length; i += 1) area += cross2(corners[i], corners[(i + 1) % corners.length]);
  return Math.abs(area) / 2;
}

function isConvex(corners) {
  let sign = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const c = corners[(i + 2) % 4];
    const z = cross2({ x: b.x - a.x, y: b.y - a.y }, { x: c.x - b.x, y: c.y - b.y });
    if (Math.abs(z) < 1e-6) return false;
    if (!sign) sign = Math.sign(z);
    else if (Math.sign(z) !== sign) return false;
  }
  return true;
}

function pointInQuad(p, corners) {
  let sign = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const z = cross2({ x: b.x - a.x, y: b.y - a.y }, { x: p.x - a.x, y: p.y - a.y });
    if (!sign) sign = Math.sign(z);
    else if (Math.sign(z) !== sign) return false;
  }
  return true;
}

// 两个四边形的重合度：用其中较小者的网格采样点落在另一个里的比例估计。
function overlap(a, b) {
  const [small, big] = quadArea(a) < quadArea(b) ? [a, b] : [b, a];
  const h = squareToQuad(small[0], small[1], small[2], small[3]);
  let inside = 0;
  for (let i = 0; i < 8; i += 1) {
    for (let j = 0; j < 8; j += 1) {
      if (pointInQuad(applyH(h, (i + 0.5) / 8, (j + 0.5) / 8), big)) inside += 1;
    }
  }
  return inside / 64;
}

function otsu(values) {
  const hist = new Array(256).fill(0);
  for (const value of values) hist[Math.max(0, Math.min(255, Math.round(value)))] += 1;
  const total = values.length;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * hist[i];
  let sumB = 0;
  let weightB = 0;
  let best = 0;
  let threshold = 128;
  for (let i = 0; i < 256; i += 1) {
    weightB += hist[i];
    if (!weightB) continue;
    const weightF = total - weightB;
    if (!weightF) break;
    sumB += i * hist[i];
    const meanB = sumB / weightB;
    const meanF = (sum - sumB) / weightF;
    const between = weightB * weightF * (meanB - meanF) ** 2;
    if (between > best) {
      best = between;
      threshold = i + 0.5;
    }
  }
  return threshold;
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function mean(values) {
  if (!values.length) return 0;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

// 确定性的像素噪声（同一张图修两次结果一样），范围 [-1, 1]。
function hashNoise(x, y) {
  let n = (x * 374761393 + y * 668265263) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n ^= n >>> 16;
  return ((n & 0xffff) / 0xffff) * 2 - 1;
}

function clamp255(value) {
  return value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function roundCorners(corners) {
  return corners ? corners.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 })) : null;
}
