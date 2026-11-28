// 组图切格：一张图里排好的几格（六格表情、四格漫画、九宫格），找出格子之间的分隔线或留白，切成同样大小的一格一格。
// 用来把组图拼成 GIF（panelgif.mjs、tools/h3-gif.mjs）。模型一次画出来的几格是同一个角色、同一套画风，
// 比一帧一帧分开画一致得多，切开按顺序播就是一组表情变化（真机 20261118-db1dd9）。
//
// 找格子在缩到长边 1024 的图上做。每一列（找竖的分隔）、每一行（找横的分隔）量两种证据：
//   细线：这一列和左右隔几个像素的列都差得多、而且朝同一个方向（都更暗或都更亮），贯穿大部分行；
//   留白：这一列几乎整列一个颜色，连着好几列都是，而且这一段两边都紧挨着一条贯穿整列的格子边。
// 再逐个假设「等分成 n 格」，看每个该有分隔的位置附近有没有证据。模型画的组图基本等分但不精确
// （db1dd9 三等分该在 341、683，实际在 343、685），所以切点贴到等分位置附近的分隔线上，不按精确的等分切；
// 附近没有像分隔的结构（格子直接挨着画，真机 20261119-250f55）就按等分位置切。
// 先按行切，每一行再单独找列：上面两格、下面三格这种排法也切得开；只有一格的矮行（标题栏、底部说明）不算格子。
import { resizeArea, toRgb } from './gif.mjs';

export const PANELS = {
  analysisEdge: 1024,
  // 每个方向最多几格。
  maxCells: 8,
  // 细线：和两侧隔 lineSpans 个像素的列，某个通道同向差超过 lineDiff 级。
  lineDiff: 16,
  lineSpans: [2, 4],
  // 留白：和整列中位色差不超过 flatTol 级的像素占 flatShare 以上，连着 flatRun 列以上。
  flatTol: 10,
  flatShare: 0.92,
  flatRun: 2,
  // 格子边：一整列里八成以上的像素和留白的颜色差这么多以上。
  edgeDiff: 15,
  // 留白的证据比细线弱一档：一整列都是背景的地方不一定是格子边界。
  flatWeight: 0.9,
  // 等分位置左右各找一格宽的这么多。
  window: 0.1,
  // 每个分隔处的证据至少这么强，这个假设（几格）才成立：分隔被越过格子的内容挡住一截也算。
  minEvidence: 0.55,
  // 切点只贴到像分隔的结构上：贯穿这一行（列）八成以上的线，或者两边都是格子边的留白带。画面里的竖线（屏幕边框、
  // 图表的坐标轴、门框）只占一部分高度：真机 20261119-250f55 的六格之间没画分隔线、格子直接挨着，程序贴到了
  // 第 2、3 格屏幕的边框和坐标轴上（线只贯穿 51–74%），切点偏了 70–120 像素。没有这样的结构就按等分位置切。
  separatorLine: 0.8,
  // 不等分的排法：单独认一条分隔线要的证据、切出来的格子最窄占多少。
  freeEvidence: 0.75,
  minCell: 0.12,
  // 图四周的外框和留白最多占这么多，先去掉再找分隔。
  maxMargin: 0.15,
  // 每条边最多往里修多少（占格子宽高的比例）。
  maxTrim: 0.06,
  // 整格几乎一个颜色：空格子，不算一格。
  blankShare: 0.97,
  // 格子宽高比差这么多以上，说明是大小不一的排法，各格缩进同一个画幅、四周补底色，不裁。
  aspectTolerance: 0.12,
  // 对齐：在长边 320 的图上找，最多挪格子宽高的 4%；比不挪贴合 10% 以上才挪。再在长边 960 的图上、粗结果附近
  // ±3 像素细调（见 alignOffsets）。
  alignEdge: 320,
  alignShift: 0.04,
  alignGain: 0.9,
  alignFine: 960,
  alignRefine: 3,
  // 对齐只比每格的中上部（左右各去掉 15%、下面去掉 30%）：组图里每格不变的是主体的头和脸，在中上部；下面的手和身体
  // 每格动作不同，两边多是背景，模型每格画的背景位置也不一样。整格一起比时，db1dd9 第二版的第 4 格（双手抱头）
  // 被举起的胳膊和背景里的绿线拉偏，头比别的格低 12 个 GIF 像素；只比中上部以后差 1 像素以内。
  alignRegion: [0.15, 0, 0.85, 0.7],
  // 过渡格（另一张图）再找缩放：±6%，在长边 480 的图上找，比不缩贴合 3% 以上才缩。
  alignZoom: 0.06,
  alignZoomEdge: 480,
  alignZoomGain: 0.97,
};

// 找格子。hints：rows / cols（几行几列，已知时给）、count（一共几格）。
// 返回 { width, height, rows, cols, count, method, strength, cells:[{index,row,col,x,y,w,h}] }，坐标是原图像素；
// 切不出两格以上时 count 为 1、cells 只有整张图。method：line（按分隔线）/ gutter（按留白）/ free（不等分）/
// even（等分：格子之间没有清楚的分隔，或者按指定的行列等分）。
export function detectPanels(image, hints) {
  const opts = hints || {};
  const rgb = toRgb(image);
  const scale = Math.min(1, PANELS.analysisEdge / Math.max(rgb.width, rgb.height));
  const w = Math.max(32, Math.round(rgb.width * scale));
  const h = Math.max(32, Math.round(rgb.height * scale));
  const small = resizeArea(rgb, w, h);
  const ctx = { small, flip: transpose(small), fx: rgb.width / w, fy: rgb.height / h };
  let result = locate(ctx, cleanHint(opts.rows), cleanHint(opts.cols));
  const want = cleanHint(opts.count);
  // 说了一共几格、自动找的对不上：按这个格数的各种排法（6 格：3×2、2×3、6×1……）各试一次，取分隔证据最强的；
  // 都没有证据（白底贴纸，格子之间什么都没有）就等分，取格子最接近方形的排法。
  if (want >= 2 && result.cells.length !== want && !opts.rows && !opts.cols) {
    let best = null;
    for (const [rows, cols] of factorPairs(want)) {
      const trial = locate(ctx, rows, cols);
      if (trial.cells.length !== want) continue;
      trial.squareness = Math.abs(Math.log(rgb.width / cols / (rgb.height / rows)));
      const stronger = best && trial.strength > best.strength + 0.05;
      const tie = best && Math.abs(trial.strength - best.strength) <= 0.05 && trial.squareness < best.squareness;
      if (!best || stronger || tie) best = trial;
    }
    if (best) result = best;
  }
  // 缩图的第 x 列取的是原图 [floor(x·fx), floor((x+1)·fx)) 这几列（resizeArea 的取法）：换算回去也用 floor，
  // 四舍五入会把分隔线的头一列带进格子里。
  const toFull = (value, factor, limit) => Math.max(0, Math.min(limit, Math.floor(value * factor)));
  const cells = result.cells.map((cell, index) => {
    const x = toFull(cell.x0, ctx.fx, rgb.width);
    const y = toFull(cell.y0, ctx.fy, rgb.height);
    return { index: index + 1, row: cell.row + 1, col: cell.col + 1, x, y, w: toFull(cell.x1, ctx.fx, rgb.width) - x, h: toFull(cell.y1, ctx.fy, rgb.height) - y };
  });
  if (cells.length < 2) {
    return { width: rgb.width, height: rgb.height, rows: 1, cols: 1, count: 1, method: 'none', strength: 0, cells: [{ index: 1, row: 1, col: 1, x: 0, y: 0, w: rgb.width, h: rgb.height }] };
  }
  return {
    width: rgb.width,
    height: rgb.height,
    rows: result.rows,
    cols: result.cols,
    count: cells.length,
    method: result.method,
    strength: round2(result.strength),
    cells,
  };
}

function cleanHint(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 1 && n <= PANELS.maxCells * PANELS.maxCells ? n : 0;
}

function factorPairs(count) {
  const out = [];
  for (let rows = 1; rows <= PANELS.maxCells; rows += 1) {
    if (count % rows) continue;
    const cols = count / rows;
    if (cols <= PANELS.maxCells) out.push([rows, cols]);
  }
  return out;
}

// 先切行，再在每一行里切列，修掉格子边上的分隔线和外框，去掉空格子。
function locate(ctx, rowHint, colHint) {
  const { small, flip } = ctx;
  const rowSplit = splitAxis(flip, Math.min(rowHint, PANELS.maxCells));
  const bands = spans(rowSplit.cuts, rowSplit.from, rowSplit.to);
  let rows = bands.map(([y0, y1]) => {
    const strip = cropRows(small, y0, y1);
    const colSplit = splitAxis(strip, Math.min(colHint, PANELS.maxCells));
    return { y0, y1, split: colSplit, cells: spans(colSplit.cuts, colSplit.from, colSplit.to) };
  });
  // 标题栏、底部说明：别的行切出了好几格，这一行只有一格又明显矮。
  const multi = rows.filter((row) => row.cells.length >= 2);
  if (multi.length) {
    const typical = median(multi.map((row) => row.y1 - row.y0));
    rows = rows.filter((row) => row.cells.length >= 2 || row.y1 - row.y0 >= typical * 0.6);
  }
  let cells = [];
  rows.forEach((row, r) => row.cells.forEach(([x0, x1], c) => cells.push({ row: r, col: c, x0, x1, y0: row.y0, y1: row.y1 })));
  cells = cells.filter((cell) => !isBlank(small, cell));
  trimCells(ctx, cells);
  const splits = [rowSplit, ...rows.map((row) => row.split)].filter((split) => split.cuts.length);
  const strength = splits.length ? Math.min(...splits.map((split) => split.strength)) : 0;
  const methods = new Set(splits.map((split) => split.method));
  const method = methods.has('even') ? 'even' : methods.has('free') ? 'free' : methods.has('gutter') ? 'gutter' : 'line';
  return { rows: rows.length, cols: Math.max(1, ...rows.map((row) => row.cells.length)), method, strength, cells };
}

function spans(cuts, from, to) {
  const edges = [from, ...cuts, to];
  const out = [];
  for (let i = 0; i + 1 < edges.length; i += 1) if (edges[i + 1] - edges[i] >= 4) out.push([edges[i], edges[i + 1]]);
  return out;
}

// ------------------------------------------------------------------ 一个方向上找分隔

// img 的每一列量证据，返回这一方向上的切点（列号）。hint 是已知的格数（0 表示不知道）。
function splitAxis(img, hint) {
  const ev = columnEvidence(img, 0, img.height);
  const { from, to } = contentSpan(img, ev);
  const span = to - from;
  const none = { cuts: [], from, to, method: 'none', strength: 0 };
  if (hint === 1 || span < 16) return none;
  // 指定了几格：附近有分隔就贴上去，没有就等分（见 evenTrial）。
  if (hint >= 2) return { ...evenTrial(ev, from, span, hint), from, to };
  // 所有分隔都找得到的假设里取格子最多的：真是三格时，按六格切会有一半切点落在格子中间，找不到证据。
  let pick = null;
  for (let n = 2; n <= PANELS.maxCells; n += 1) {
    const trial = evenTrial(ev, from, span, n);
    if (trial.strength >= PANELS.minEvidence) pick = trial;
  }
  if (pick) return { ...pick, from, to };
  const free = freeCuts(ev, from, to);
  return free.length ? { cuts: free, from, to, method: 'free', strength: Math.min(...free.map((x) => ev.score[x])) } : none;
}

// 假设等分成 n 格：每个等分位置附近（离等分位置越远扣得越多）找证据。
// 这个假设成不成立（strength）看窗口里最强的证据；切点只贴到像分隔的结构上（见 PANELS.separatorLine），没有就按等分位置切。
// 一段分隔里只能有一个切点：两个切点落进同一段，说明这段是一整片背景，不是两条边界。
function evenTrial(ev, from, span, n) {
  const cell = span / n;
  const win = Math.max(2, Math.round(cell * PANELS.window));
  const cuts = [];
  let strength = 1;
  let snapped = 0;
  let gutter = false;
  let lastEnd = -1;
  for (let k = 1; k < n; k += 1) {
    const target = from + k * cell;
    let best = Math.round(target);
    let bestScore = -Infinity;
    let sep = -1;
    let sepScore = -Infinity;
    const lo = Math.max(from + 2, Math.round(target - win));
    const hi = Math.min(from + span - 3, Math.round(target + win));
    for (let x = lo; x <= hi; x += 1) {
      const score = ev.score[x] - (0.15 * Math.abs(x - target)) / win;
      if (score > bestScore) {
        bestScore = score;
        best = x;
      }
      if ((ev.line[x] >= PANELS.separatorLine || ev.band[x]) && score > sepScore) {
        sepScore = score;
        sep = x;
      }
    }
    strength = Math.min(strength, ev.score[best]);
    if (sep < 0) {
      cuts.push(Math.round(target));
      continue;
    }
    snapped += 1;
    if (ev.line[sep] < ev.flatScore[sep]) gutter = true;
    const [a, b] = structureExtent(ev, sep);
    if (a <= lastEnd) strength = 0;
    lastEnd = b;
    // 切在整条分隔（线、留白、两边格子的边框连在一起）的中间；很宽的分不清边界在哪，按等分位置切。
    cuts.push(b - a > cell * 0.3 ? Math.max(a, Math.min(b, Math.round(target))) : Math.round((a + b) / 2));
  }
  return { cuts, strength, method: !snapped ? 'even' : gutter ? 'gutter' : 'line', n };
}

// 分隔处的整段结构：线、两边都是格子边的留白带，中间允许隔一列缩图混出来的过渡色。
// 带边框的格子之间是「边框 + 留白 + 边框」，只切在其中一条边框上，一边的格子会带着整条留白和对面的边框。
function structureExtent(ev, x) {
  const part = (i) => i >= 0 && i < ev.line.length && (ev.line[i] >= 0.5 || ev.band[i] === 1);
  let a = x;
  let b = x;
  for (;;) {
    if (part(a - 1)) a -= 1;
    else if (part(a - 2)) a -= 2;
    else break;
  }
  for (;;) {
    if (part(b + 1)) b += 1;
    else if (part(b + 2)) b += 2;
    else break;
  }
  return [a, b];
}

function sameColor(colors, a, b) {
  return Math.max(Math.abs(colors[a * 3] - colors[b * 3]), Math.abs(colors[a * 3 + 1] - colors[b * 3 + 1]), Math.abs(colors[a * 3 + 2] - colors[b * 3 + 2])) <= 12;
}

// 不等分的排法：只认很强的细线和两边都是格子边的留白带，切出来的格子不能太窄。
function freeCuts(ev, from, to) {
  const span = to - from;
  const minCell = Math.max(8, Math.round(span * PANELS.minCell));
  const found = [];
  for (let x = from + minCell; x <= to - minCell; x += 1) {
    const line = ev.line[x] >= PANELS.freeEvidence;
    const gutter = !line && ev.band[x] && ev.flat[x] >= PANELS.blankShare;
    if (!line && !gutter) continue;
    const score = line ? ev.line[x] : ev.flatScore[x];
    const last = found[found.length - 1];
    if (last && x - last.x < minCell) {
      if (score > last.score) found[found.length - 1] = { x, score, line };
      continue;
    }
    found.push({ x, score, line });
  }
  return found.map((item) => {
    const [a, b] = structureExtent(ev, item.x);
    return Math.round((a + b) / 2);
  });
}

// 四周的外框和留白：两头各往里数「结构」有多宽（见 borderWidth），找分隔时按去掉之后的范围等分。
function contentSpan(img, ev) {
  const width = img.width;
  const limit = Math.round(width * PANELS.maxMargin);
  const from = borderWidth(img, ev, 0, 1, limit, 0, img.height);
  const to = width - borderWidth(img, ev, width - 1, -1, limit, 0, img.height);
  if (to - from < width * 0.5) return { from: 0, to: width };
  return { from, to };
}

// 从 start 往 dir 方向数，边上有多宽是结构：分隔线、外框线，或者一片同色留白、紧接着一条贯穿整列的格子边（或者一条线）。
// 格子自己的空白背景后面接的是头发、衣服这些零散的内容，不算：db1dd9 每格顶上那一截浅灰底以前被当成外边距修掉，
// 上面一行的格子比下面一行少一截，切出来人物上下差了 46 像素。
function borderWidth(img, ev, start, dir, limit, y0, y1) {
  const at = (t) => start + dir * t;
  let t = 0;
  for (let guard = 0; guard < 8 && t < limit; guard += 1) {
    let lineEnd = -1;
    for (let k = t; k < Math.min(limit, t + 4); k += 1) if (ev.line[at(k)] >= 0.5) lineEnd = k;
    if (lineEnd >= 0) {
      let k = lineEnd + 1;
      while (k < limit && ev.line[at(k)] >= 0.5) k += 1;
      // 线的另一边再多修一列：抗锯齿的过渡像素留在边上，播起来是一圈细边。
      t = Math.min(limit, k + 1);
      continue;
    }
    let k = t;
    while (k < limit && ev.flat[at(k)] >= PANELS.blankShare && sameColor(ev.color, at(k), at(t))) k += 1;
    if (k === t || k >= limit) break;
    // 留白和格子之间常有一列缩图时混出来的过渡色：它后面那一列才是格子边，过渡色那一列一起修掉。
    const edgeAt = (i) => ev.line[at(i)] >= 0.5 || differShare(img, at(i), y0, y1, ev.color, at(t)) >= 0.8;
    if (edgeAt(k)) t = k;
    else if (k + 1 < limit && edgeAt(k + 1)) t = k + 1;
    else break;
  }
  return t;
}

// 第 x 列在 [y0, y1) 行里和 colors 里第 ref 列的颜色差得明显的像素占多少。
function differShare(img, x, y0, y1, colors, ref) {
  const { width: w, data } = img;
  const step = Math.max(1, Math.floor((y1 - y0) / 400));
  let differ = 0;
  let count = 0;
  for (let y = y0; y < y1; y += step) {
    const o = (y * w + x) * 3;
    count += 1;
    if (Math.max(Math.abs(data[o] - colors[ref * 3]), Math.abs(data[o + 1] - colors[ref * 3 + 1]), Math.abs(data[o + 2] - colors[ref * 3 + 2])) > PANELS.edgeDiff) differ += 1;
  }
  return count ? differ / count : 0;
}

// 每一列在 [y0, y1) 行里的证据：line 细线占比、flat 留白占比、band 是否在一条留白带里、score 综合证据、color 中位色。
function columnEvidence(img, y0, y1) {
  const { width: w, data } = img;
  const rows = Math.max(1, y1 - y0);
  const step = Math.max(1, Math.floor(rows / 400));
  const line = new Float32Array(w);
  const flat = new Float32Array(w);
  const color = new Uint8Array(w * 3);
  const T = PANELS.lineDiff;
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  for (let x = 0; x < w; x += 1) {
    let hits = 0;
    let count = 0;
    for (const bins of hist) bins.fill(0);
    for (let y = y0; y < y1; y += step) {
      const o = (y * w + x) * 3;
      count += 1;
      hist[0][data[o]] += 1;
      hist[1][data[o + 1]] += 1;
      hist[2][data[o + 2]] += 1;
      let hit = false;
      for (const d of PANELS.lineSpans) {
        if (x - d < 0 || x + d >= w) continue;
        const l = o - d * 3;
        const r = o + d * 3;
        for (let c = 0; c < 3; c += 1) {
          const a = data[o + c] - data[l + c];
          const b = data[o + c] - data[r + c];
          if ((a > T && b > T) || (a < -T && b < -T)) {
            hit = true;
            break;
          }
        }
        if (hit) break;
      }
      if (hit) hits += 1;
    }
    line[x] = count ? hits / count : 0;
    for (let c = 0; c < 3; c += 1) color[x * 3 + c] = medianOf(hist[c], count);
    let same = 0;
    for (let y = y0; y < y1; y += step) {
      const o = (y * w + x) * 3;
      if (Math.max(Math.abs(data[o] - color[x * 3]), Math.abs(data[o + 1] - color[x * 3 + 1]), Math.abs(data[o + 2] - color[x * 3 + 2])) <= PANELS.flatTol) same += 1;
    }
    flat[x] = count ? same / count : 0;
  }
  // 留白带：连着 flatRun 列以上整列一个颜色、颜色也接得上，而且两边都紧挨着一条贯穿整列的格子边（或者图边）。
  // 格子自己的纯色底也是整列一个颜色，但它一边挨着的是人物这些零散的内容：不认它，否则一格会被底色切成好几格
  // （彩色底的两格，按六格切的每个切点都落在一片纯色底里）。
  const band = new Uint8Array(w);
  const rawRun = (x) => flat[x] >= PANELS.flatShare;
  let x = 0;
  while (x < w) {
    if (!rawRun(x)) {
      x += 1;
      continue;
    }
    let e = x + 1;
    // 和这一段的第一列比颜色，不和前一列比：过渡色一列一列只差几级，接着比会把底色和留白连成一段。
    while (e < w && rawRun(e) && sameColor(color, e, x)) e += 1;
    if (e - x >= PANELS.flatRun) {
      const straight = (at, ref) => at < 0 || at >= w || differShare(img, at, y0, y1, color, ref) >= 0.8;
      const leftEdge = straight(x - 1, x) || straight(x - 2, x);
      const rightEdge = straight(e, e - 1) || straight(e + 1, e - 1);
      if (leftEdge && rightEdge) band.fill(1, x, e);
    }
    x = e;
  }
  const flatScore = new Float32Array(w);
  const score = new Float32Array(w);
  for (let x = 0; x < w; x += 1) {
    flatScore[x] = band[x] ? flat[x] * PANELS.flatWeight : 0;
    score[x] = Math.max(line[x], flatScore[x]);
  }
  return { line, flat, band, flatScore, score, color };
}

function medianOf(bins, count) {
  let acc = 0;
  const half = count / 2;
  for (let v = 0; v < 256; v += 1) {
    acc += bins[v];
    if (acc >= half) return v;
  }
  return 255;
}

// ------------------------------------------------------------------ 修边、空格

// 格子边上残留的分隔线、外框、半条留白修掉（只修结构，见 borderWidth）。每一格按自己的边修：
// 等分的组图里每格的结构一样宽，修完各格一样大；最外面的格子带着外边距，里面的格子没有，统一修同样多会让内容错位。
function trimCells(ctx, cells) {
  for (const cell of cells) {
    const left = edgeTrim(ctx, cell, 'left');
    const right = edgeTrim(ctx, cell, 'right');
    const top = edgeTrim(ctx, cell, 'top');
    const bottom = edgeTrim(ctx, cell, 'bottom');
    cell.x0 += left;
    cell.x1 -= right;
    cell.y0 += top;
    cell.y1 -= bottom;
  }
}

// 一格的一条边往里该修多少，最多修这一格宽（高）的 maxTrim。
// 取边上那几列时两头各多带 4 列：判断一列是不是线要和它两侧隔几个像素的列比，切点正好落在线中间。
function edgeTrim(ctx, cell, side) {
  const vertical = side === 'left' || side === 'right';
  const img = vertical ? ctx.small : ctx.flip;
  const lo = vertical ? cell.y0 : cell.x0;
  const hi = vertical ? cell.y1 : cell.x1;
  const a = vertical ? cell.x0 : cell.y0;
  const b = vertical ? cell.x1 : cell.y1;
  const limit = Math.max(1, Math.round((b - a) * PANELS.maxTrim));
  const pad = 4;
  const near = side === 'left' || side === 'top';
  const slice = sliceCols(img, near ? a - pad : b - limit - pad, limit + 2 * pad);
  const ev = columnEvidence(slice, lo, hi);
  return borderWidth(slice, ev, near ? pad : limit + pad - 1, near ? 1 : -1, limit, lo, hi);
}

// 取 [x, x+n) 这几列（越界的按边上的列补），给 columnEvidence 用：它要的是一张完整的小图。
function sliceCols(img, x, n) {
  const { width: w, height: h, data } = img;
  const out = Buffer.alloc(n * h * 3);
  for (let y = 0; y < h; y += 1) {
    for (let i = 0; i < n; i += 1) {
      const sx = Math.max(0, Math.min(w - 1, x + i));
      data.copy(out, (y * n + i) * 3, (y * w + sx) * 3, (y * w + sx) * 3 + 3);
    }
  }
  return { width: n, height: h, channels: 3, data: out };
}

function isBlank(img, cell) {
  const { width: w, data } = img;
  const step = Math.max(1, Math.floor(Math.sqrt(((cell.x1 - cell.x0) * (cell.y1 - cell.y0)) / 4000)));
  const samples = [];
  for (let y = cell.y0; y < cell.y1; y += step) for (let x = cell.x0; x < cell.x1; x += step) samples.push((y * w + x) * 3);
  if (!samples.length) return true;
  const mid = [0, 1, 2].map((c) => median(samples.map((o) => data[o + c])));
  let same = 0;
  for (const o of samples) {
    if (Math.max(Math.abs(data[o] - mid[0]), Math.abs(data[o + 1] - mid[1]), Math.abs(data[o + 2] - mid[2])) <= PANELS.flatTol) same += 1;
  }
  return same / samples.length >= PANELS.blankShare;
}

// ------------------------------------------------------------------ 统一大小、对齐

// 把各格变成同样大小的取景框。格子大小一致（差几个像素）时各格居中取同样大小；align 为 true 时再按画面
// 对齐：模型在每一格里画的主体位置差一点，原样播放主体会一跳一跳的。大小不一的排法不裁，缩进同一个画幅。
// 返回 { mode: 'crop' | 'fit', width, height, frames:[{x,y,w,h,dx,dy}] }，crop 时每格取原图的 (x,y,w,h)。
export function framePanels(image, cells, options) {
  const opts = options || {};
  const rgb = toRgb(image);
  const aspects = cells.map((cell) => cell.w / cell.h);
  const typical = median(aspects);
  const mixed = aspects.some((value) => Math.abs(value - typical) / typical > PANELS.aspectTolerance);
  if (mixed) {
    const width = Math.round(median(cells.map((cell) => cell.w)));
    const height = Math.round(median(cells.map((cell) => cell.h)));
    return { mode: 'fit', width, height, frames: cells.map((cell) => ({ x: cell.x, y: cell.y, w: cell.w, h: cell.h, dx: 0, dy: 0 })), aligned: 0 };
  }
  const baseW = Math.min(...cells.map((cell) => cell.w));
  const baseH = Math.min(...cells.map((cell) => cell.h));
  const centered = cells.map((cell) => ({ cx: cell.x + cell.w / 2, cy: cell.y + cell.h / 2 }));
  let offsets = cells.map(() => ({ dx: 0, dy: 0 }));
  if (opts.align !== false && cells.length >= 2) offsets = alignOffsets(rgb, centered, baseW, baseH, opts.reference || 0);
  const maxDx = Math.max(...offsets.map((item) => Math.abs(item.dx)));
  const maxDy = Math.max(...offsets.map((item) => Math.abs(item.dy)));
  const width = Math.max(8, Math.floor(baseW - 2 * maxDx));
  const height = Math.max(8, Math.floor(baseH - 2 * maxDy));
  const frames = centered.map((center, index) => {
    const x = Math.round(center.cx + offsets[index].dx - width / 2);
    const y = Math.round(center.cy + offsets[index].dy - height / 2);
    return {
      x: Math.max(0, Math.min(rgb.width - width, x)),
      y: Math.max(0, Math.min(rgb.height - height, y)),
      w: width,
      h: height,
      dx: Math.round(offsets[index].dx),
      dy: Math.round(offsets[index].dy),
    };
  });
  return { mode: 'crop', width, height, frames, aligned: offsets.filter((item) => item.dx || item.dy).length };
}

// 每一格相对参考格（默认第一格）挪多少（原图像素）：先在长边 320 的梯度图上大范围找，再在长边 960 的图上、
// 粗结果附近细找一次，都用抛物线细到亚像素。只粗找的话，320 的图上 1 像素是原图 5–6 像素，对齐完各格还差 1–2 像素
// （真机 20261119-250f55 第二行三格的头比第一格低 0.6–0.7 个 GIF 像素，切换时线稿轮廓会抖一下）。
function alignOffsets(rgb, centers, baseW, baseH, reference) {
  const coarse = matchPanels(rgb, centers, baseW, baseH, reference, PANELS.alignEdge, null);
  return matchPanels(rgb, centers, baseW, baseH, reference, PANELS.alignFine, coarse);
}

// prior 没给是粗找：±alignShift 的范围，要比不挪明显更贴合（alignGain）、又没顶到搜索边界才算，
// 顶到边界多半是两格的内容本来就不一样（动作大），硬对反而错开。prior 给了是细调：每一格先按粗结果挪过去再取图，
// 在附近 ±alignRefine 像素里找，没顶到边界就算；粗找没对上的格子不细调。
function matchPanels(rgb, centers, baseW, baseH, reference, edge, prior) {
  const scale = Math.min(1, edge / Math.max(baseW, baseH));
  const w = Math.max(16, Math.round(baseW * scale));
  const h = Math.max(16, Math.round(baseH * scale));
  const origin = (center, shift) => ({ x: Math.round(center.cx + shift.dx - baseW / 2), y: Math.round(center.cy + shift.dy - baseH / 2) });
  const sample = (at) => gradient(resizeArea(cropImage(rgb, at.x, at.y, baseW, baseH), w, h));
  const refCenter = centers[reference] || centers[0];
  const refAt = origin(refCenter, { dx: 0, dy: 0 });
  const ref = sample(refAt);
  const R = prior ? PANELS.alignRefine : Math.max(2, Math.round(Math.max(w, h) * PANELS.alignShift));
  return centers.map((center, index) => {
    if (index === reference) return { dx: 0, dy: 0, matched: true };
    const start = prior ? prior[index] : { dx: 0, dy: 0, matched: true };
    if (!start.matched) return start;
    const at = origin(center, start);
    const found = bestShift(ref, sample(at), w, h, R, !prior);
    if (!found) return prior ? start : { dx: 0, dy: 0, matched: false };
    // 两边取图的位置都取过整：按取整之后的位置算这一格相对参考格挪了多少，再加上在这张图上找到的平移。
    return {
      dx: at.x - refAt.x - (center.cx - refCenter.cx) + (found.u * baseW) / w,
      dy: at.y - refAt.y - (center.cy - refCenter.cy) + (found.v * baseH) / h,
      matched: true,
    };
  });
}

// 在 ±R 里找 b 相对 a 挪多少最贴合（只比 alignRegion 那一块，隔一个像素取样比梯度差），返回 { u, v }（亚像素）或 null。
function bestShift(a, b, w, h, R, strict) {
  const side = 2 * R + 1;
  const costs = new Float64Array(side * side);
  const [rx0, ry0, rx1, ry1] = PANELS.alignRegion;
  const xa = Math.max(R, Math.round(rx0 * w));
  const xb = Math.min(w - R, Math.round(rx1 * w));
  const ya = Math.max(R, Math.round(ry0 * h));
  const yb = Math.min(h - R, Math.round(ry1 * h));
  for (let v = -R; v <= R; v += 1) {
    for (let u = -R; u <= R; u += 1) {
      let sum = 0;
      let n = 0;
      for (let y = ya; y < yb; y += 2) {
        const ra = y * w;
        const rb = (y + v) * w + u;
        for (let x = xa; x < xb; x += 2) {
          sum += Math.abs(a[ra + x] - b[rb + x]);
          n += 1;
        }
      }
      costs[(v + R) * side + u + R] = n ? sum / n : Infinity;
    }
  }
  let bi = 0;
  for (let i = 1; i < costs.length; i += 1) if (costs[i] < costs[bi]) bi = i;
  const bu = bi % side;
  const bv = (bi / side) | 0;
  if (bu === 0 || bv === 0 || bu === side - 1 || bv === side - 1) return null;
  if (strict && !(costs[bi] <= costs[R * side + R] * PANELS.alignGain)) return null;
  const refine = (before, at, after) => {
    const den = before - 2 * at + after;
    return den > 1e-9 ? Math.max(-0.5, Math.min(0.5, (0.5 * (before - after)) / den)) : 0;
  };
  return { u: bu - R + refine(costs[bi - 1], costs[bi], costs[bi + 1]), v: bv - R + refine(costs[bi - side], costs[bi], costs[bi + side]), cost: costs[bi] };
}

// 另一张图（rgb，比例和参考图一样、大小可以不同）里对应的那一块，对齐到参考图 refRgb 里的 refFrame。
// 给过渡格用：过渡格是在原组图上改出来的另一张图，格子的位置和原图差不多，人物的头要和原图那一格对上。
// guess 是这一块在 rgb 里的中心（rgb 的像素）。先在长边 320 的图上粗找（明显更贴合才挪），再在长边 960 的图上
// 细调；粗找没对上就按 guess 细调。比的都是每格的中上部（见 alignRegion）。
// 最后再找一次缩放：另一张图是重画的，人物常被画大或画小一两个百分点（真机 20261119-250f55 的一格过渡格大了约 3%），
// 只挪不缩的话，头的轮廓前后两帧对不上，播起来一胀一缩。
// 返回 rgb 里对齐后的取景框 { x, y, w, h, dx, dy, scale, matched }：大小是 refFrame 按两张图的比例缩放、再除以 scale 的大小，
// 拿去缩到和别的格子一样大，人物就一样大了。
// 横竖分别按两张图的比例缩放：接口回的图比例和原图不一定完全一样（5472×3072 改出来是 2720×1536，横竖差 0.6%），
// 只按宽度缩放的话，越往下的格子差得越多。
export function alignAcross(refRgb, refFrame, rgb, guess) {
  const w0 = Math.max(8, Math.round((refFrame.w * rgb.width) / refRgb.width));
  const h0 = Math.max(8, Math.round((refFrame.h * rgb.height) / refRgb.height));
  const coarse = matchAcross(refRgb, refFrame, rgb, guess, w0, h0, PANELS.alignEdge, null);
  const fine = matchAcross(refRgb, refFrame, rgb, guess, w0, h0, PANELS.alignFine, coarse.matched ? coarse : { dx: 0, dy: 0, matched: false });
  const zoom = matchScale(refRgb, refFrame, rgb, { cx: guess.cx + fine.dx, cy: guess.cy + fine.dy }, w0, h0);
  const w = Math.max(8, Math.min(rgb.width, Math.round(w0 / zoom.scale)));
  const h = Math.max(8, Math.min(rgb.height, Math.round(h0 / zoom.scale)));
  const x = Math.round(zoom.cx - w / 2);
  const y = Math.round(zoom.cy - h / 2);
  return {
    x: Math.max(0, Math.min(rgb.width - w, x)),
    y: Math.max(0, Math.min(rgb.height - h, y)),
    w,
    h,
    dx: Math.round(zoom.cx - guess.cx),
    dy: Math.round(zoom.cy - guess.cy),
    scale: zoom.scale,
    matched: coarse.matched,
  };
}

// 在 ±alignZoom 的范围里一个百分点一个百分点地试缩放（每个缩放再细找 ±2 像素的平移），取最贴合的。
// 比不缩明显好（alignGain）才缩，免得在纹理平的格子里乱缩。
function matchScale(refRgb, refFrame, rgb, center, w0, h0) {
  const edge = PANELS.alignZoomEdge;
  const scale = Math.min(1, edge / Math.max(refFrame.w, refFrame.h));
  const w = Math.max(16, Math.round(refFrame.w * scale));
  const h = Math.max(16, Math.round(refFrame.h * scale));
  const ref = gradient(resizeArea(cropImage(refRgb, refFrame.x, refFrame.y, refFrame.w, refFrame.h), w, h));
  const tryScale = (s) => {
    const cw = Math.max(8, Math.round(w0 / s));
    const ch = Math.max(8, Math.round(h0 / s));
    const got = gradient(resizeArea(cropImage(rgb, Math.round(center.cx - cw / 2), Math.round(center.cy - ch / 2), cw, ch), w, h));
    const found = bestShift(ref, got, w, h, 2, false);
    return found ? { s, cost: found.cost, cx: center.cx + (found.u * cw) / w, cy: center.cy + (found.v * ch) / h } : null;
  };
  const base = tryScale(1) || { s: 1, cost: Infinity, cx: center.cx, cy: center.cy };
  let best = base;
  const steps = Math.round(PANELS.alignZoom / 0.01);
  for (let k = -steps; k <= steps; k += 1) {
    if (!k) continue;
    const got = tryScale(1 + k * 0.01);
    if (got && got.cost < best.cost) best = got;
  }
  if (best !== base && !(best.cost <= base.cost * PANELS.alignZoomGain)) best = base;
  return { scale: best.s, cx: best.cx, cy: best.cy };
}

function matchAcross(refRgb, refFrame, rgb, guess, w0, h0, edge, prior) {
  const scale = Math.min(1, edge / Math.max(refFrame.w, refFrame.h));
  const w = Math.max(16, Math.round(refFrame.w * scale));
  const h = Math.max(16, Math.round(refFrame.h * scale));
  const ref = gradient(resizeArea(cropImage(refRgb, refFrame.x, refFrame.y, refFrame.w, refFrame.h), w, h));
  const start = prior || { dx: 0, dy: 0 };
  const at = { x: Math.round(guess.cx + start.dx - w0 / 2), y: Math.round(guess.cy + start.dy - h0 / 2) };
  const got = gradient(resizeArea(cropImage(rgb, at.x, at.y, w0, h0), w, h));
  const R = prior ? PANELS.alignRefine : Math.max(2, Math.round(Math.max(w, h) * PANELS.alignShift));
  const found = bestShift(ref, got, w, h, R, !prior);
  if (!found) return prior ? { ...prior } : { dx: 0, dy: 0, matched: false };
  return {
    dx: at.x - (guess.cx - w0 / 2) + (found.u * w0) / w,
    dy: at.y - (guess.cy - h0 / 2) + (found.v * h0) / h,
    matched: prior ? Boolean(prior.matched) : true,
  };
}

function gradient(img) {
  const { width: w, height: h, data } = img;
  const lum = new Float32Array(w * h);
  for (let p = 0; p < w * h; p += 1) lum[p] = 0.299 * data[p * 3] + 0.587 * data[p * 3 + 1] + 0.114 * data[p * 3 + 2];
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const p = y * w + x;
      out[p] = Math.abs(lum[p + 1] - lum[p - 1]) + Math.abs(lum[p + w] - lum[p - w]);
    }
  }
  return out;
}

// ------------------------------------------------------------------ 出一格的画面

// 按取景框出一格、缩到 outW×outH。zoom 大于 1 时取中间 1/zoom 的一块放大（切换时轻微弹一下用）。
// fit 模式（格子大小不一）把整格缩进画幅、四周补这一格边上的底色。
export function renderPanel(image, frame, outW, outH, options) {
  const opts = options || {};
  const zoom = Math.max(1, Number(opts.zoom) || 1);
  const rgb = toRgb(image);
  if (opts.mode === 'fit') {
    const scale = Math.min(outW / frame.w, outH / frame.h) / zoom;
    const fw = Math.max(1, Math.round(frame.w * scale * zoom));
    const fh = Math.max(1, Math.round(frame.h * scale * zoom));
    const canvas = Buffer.alloc(outW * outH * 3);
    const fill = edgeColor(rgb, frame);
    for (let p = 0; p < outW * outH; p += 1) canvas.set(fill, p * 3);
    const cw = Math.min(fw, outW);
    const ch = Math.min(fh, outH);
    const sw = Math.round((cw / fw) * frame.w);
    const sh = Math.round((ch / fh) * frame.h);
    const part = resizeArea(cropImage(rgb, frame.x + Math.round((frame.w - sw) / 2), frame.y + Math.round((frame.h - sh) / 2), sw, sh), cw, ch);
    const ox = Math.floor((outW - cw) / 2);
    const oy = Math.floor((outH - ch) / 2);
    for (let y = 0; y < ch; y += 1) part.data.copy(canvas, ((oy + y) * outW + ox) * 3, y * cw * 3, (y + 1) * cw * 3);
    return { width: outW, height: outH, channels: 3, data: canvas };
  }
  const w = Math.max(1, Math.round(frame.w / zoom));
  const h = Math.max(1, Math.round(frame.h / zoom));
  return resizeArea(cropImage(rgb, frame.x + Math.round((frame.w - w) / 2), frame.y + Math.round((frame.h - h) / 2), w, h), outW, outH);
}

function edgeColor(rgb, frame) {
  const values = [[], [], []];
  const push = (x, y) => {
    const o = (Math.max(0, Math.min(rgb.height - 1, y)) * rgb.width + Math.max(0, Math.min(rgb.width - 1, x))) * 3;
    for (let c = 0; c < 3; c += 1) values[c].push(rgb.data[o + c]);
  };
  const inset = 2;
  for (let x = frame.x; x < frame.x + frame.w; x += Math.max(1, Math.floor(frame.w / 64))) {
    push(x, frame.y + inset);
    push(x, frame.y + frame.h - 1 - inset);
  }
  for (let y = frame.y; y < frame.y + frame.h; y += Math.max(1, Math.floor(frame.h / 64))) {
    push(frame.x + inset, y);
    push(frame.x + frame.w - 1 - inset, y);
  }
  return Buffer.from(values.map((list) => median(list)));
}

// ------------------------------------------------------------------ 小工具

export function cropImage(rgb, x, y, w, h) {
  const out = Buffer.alloc(w * h * 3);
  for (let row = 0; row < h; row += 1) {
    const sy = Math.max(0, Math.min(rgb.height - 1, y + row));
    for (let col = 0; col < w; col += 1) {
      const sx = Math.max(0, Math.min(rgb.width - 1, x + col));
      const s = (sy * rgb.width + sx) * 3;
      const d = (row * w + col) * 3;
      out[d] = rgb.data[s];
      out[d + 1] = rgb.data[s + 1];
      out[d + 2] = rgb.data[s + 2];
    }
  }
  return { width: w, height: h, channels: 3, data: out };
}

function cropRows(img, y0, y1) {
  const { width: w, data } = img;
  return { width: w, height: y1 - y0, channels: 3, data: Buffer.from(data.subarray(y0 * w * 3, y1 * w * 3)) };
}

function transpose(img) {
  const { width: w, height: h, data } = img;
  const out = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const s = (y * w + x) * 3;
      const d = (x * h + y) * 3;
      out[d] = data[s];
      out[d + 1] = data[s + 1];
      out[d + 2] = data[s + 2];
    }
  }
  return { width: h, height: w, channels: 3, data: out };
}

function median(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}
