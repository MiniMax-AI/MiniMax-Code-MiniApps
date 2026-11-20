// 组图 GIF 的过渡格：相邻两格之间各补一格「中间状态」，一格一格的切换变成一步一步的动作。
//
// 组图拼成的 GIF 是一格一格地切：表情、手一下子换掉（真机 20261119-250f55）。过渡格一起生成，能从候选里选：
// 在原组图上改一次，把每一格都改成「它和下一格中间」的样子，接口一次出 2 张候选；每一步先由程序筛掉照抄的，
// 再由过渡格评审从剩下的候选里挑一格，没挑到的步子再出一轮。一格一格单独画，每格只有一张，挑不了，画风也会一格一格地漂。
//
// 每一格怎么改由过渡格规划节点看着组图写清楚（手抬到哪、嘴张多大）。只说「画两格中间的样子」，模型几乎都是照抄下一格：
// 真机试过，6 格里 4 到 6 格是照抄的；把「下一格」拼成第 2 张图送进去也一样。写清每一格的样子以后，两张候选 6 格都画成了中间状态。
//
// 过渡格是另一张图：格子位置和原组图差不多但不完全一样（接口回的图比例和原图差 0.6%，越往右的格子差得越多），
// 每一格先对齐到原组图同一格的人物上（panels.alignAcross），再拿来比、拿来播。
import { access, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import * as h3 from './h3.mjs';
import { decodeImage } from './image.mjs';
import { changeShare, gifSize, resizeArea, toRgb } from './gif.mjs';
import { pairKey } from './gifbuild.mjs';
import { alignAcross, cropImage, detectPanels, framePanels, renderPanel } from './panels.mjs';
import { encodePng } from './png.mjs';
import { renderGridSheet } from './review.mjs';
import { detail, kv, list, text } from './detail.mjs';
import { difficultyOf, hitsOf, noteToolHit, toolBudget } from './budget.mjs';

export const TWEEN = {
  candidates: 2,
  // 一张组图最多出几轮过渡格（第二轮只补第一轮没挑到的步子）。
  rounds: 2,
  // 两格之间锁好位置后整幅变了这么多以上（任一通道差 24 级以上的像素占比）：不是同一个镜头，不补。
  sceneChange: 0.5,
  // 两格变了的地方，过渡格有这么多跟另一头一样：照抄了另一头。真机照抄的 0.86–0.99，画了中间状态的 0.07–0.76。
  copyOther: 0.85,
  // 这么少：这一格没改，原样又画了一遍。
  unchanged: 0.03,
  // 离两头都远：到两头的距离加起来超过两头之间距离的这么多倍，画走了样（真机画对的最多 2.2）。
  maxExcess: 2.6,
  sheetCell: 280,
};

// 要补哪几步：按播放顺序相邻的两格，循环播放（不来回）时再加最后一格接回第一格。来回播往回走用的是同一格。
// 每一步画在其中一格的位置上（cell）：先用前一格的位置，那一格已经被别的步子占了就用后一格（中间状态两头都一样）。
// 还占不下的（播放顺序里同一格出现两次）留给下一轮。
export function tweenPairs(count, spec) {
  const s = spec || {};
  const dropped = new Set((Array.isArray(s.drop) ? s.drop : []).map(Number));
  let order = (Array.isArray(s.order) && s.order.length ? s.order : Array.from({ length: count }, (_, i) => i + 1))
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= count && !dropped.has(n));
  order = order.filter((n, i) => i === 0 || n !== order[i - 1]);
  const loop = s.loop !== false;
  if (loop && order.length > 2 && order[0] === order[order.length - 1]) order.pop();
  const steps = [];
  for (let i = 0; i + 1 < order.length; i += 1) steps.push([order[i], order[i + 1]]);
  if (loop && !s.pingpong && order.length > 2) steps.push([order[order.length - 1], order[0]]);
  const seen = new Set();
  const out = [];
  for (const [from, to] of steps) {
    const key = pairKey(from, to);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, from, to });
  }
  return out;
}

function assignCells(pairs) {
  const used = new Set();
  const assigned = new Map();
  for (const pair of pairs) {
    const cell = !used.has(pair.from) ? pair.from : !used.has(pair.to) ? pair.to : 0;
    if (!cell) continue;
    used.add(cell);
    assigned.set(cell, pair);
  }
  return assigned;
}

// ------------------------------------------------------------------ 量过渡格

// 缩到 W×H 的灰度图，模糊 r 像素：比的是形状挪到了哪，不是纹理。三张图要缩到同一个 W×H 才能逐像素比
// （过渡格按缩放对齐以后大小和格子差几个像素）。
function thumb(img, W, H, r) {
  const small = resizeArea(toRgb(img), W, H).data;
  let g = new Float32Array(W * H);
  for (let p = 0; p < g.length; p += 1) g[p] = 0.299 * small[p * 3] + 0.587 * small[p * 3 + 1] + 0.114 * small[p * 3 + 2];
  for (let pass = 0; pass < 2 && r > 0; pass += 1) {
    for (const horizontal of [true, false]) {
      const out = new Float32Array(g.length);
      for (let y = 0; y < H; y += 1) {
        for (let x = 0; x < W; x += 1) {
          let sum = 0;
          let n = 0;
          for (let k = -r; k <= r; k += 1) {
            const xx = horizontal ? x + k : x;
            const yy = horizontal ? y : y + k;
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            sum += g[yy * W + xx];
            n += 1;
          }
          out[y * W + x] = sum / n;
        }
      }
      g = out;
    }
  }
  return g;
}

function distance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return a.length ? sum / a.length : 0;
}

// own 是过渡格所在那一格（底图）、other 是另一头、tween 是过渡格，三张同样大小。
// near：两头不一样的地方（按差多少加权），过渡格有多少更像另一头。照抄另一头接近 1，没改接近 0。
// excess：到两头的距离之和 ÷ 两头之间的距离，正常的中间状态在 1 到 2 左右，画走了样会更大。
export function tweenMetrics(own, other, tween) {
  const W = 160;
  const H = Math.max(1, Math.round((W * own.height) / own.width));
  const a = thumb(own, W, H, 1);
  const b = thumb(other, W, H, 1);
  const m = thumb(tween, W, H, 1);
  let toOther = 0;
  let total = 0;
  for (let i = 0; i < a.length; i += 1) {
    const w = Math.abs(b[i] - a[i]);
    if (w < 6) continue;
    total += w;
    if (Math.abs(m[i] - b[i]) < Math.abs(m[i] - a[i])) toOther += w;
  }
  const H2 = Math.max(1, Math.round((128 * own.height) / own.width));
  const A = thumb(own, 128, H2, 3);
  const B = thumb(other, 128, H2, 3);
  const M = thumb(tween, 128, H2, 3);
  const span = distance(A, B);
  const near = total ? toOther / total : 0.5;
  const excess = span > 0.01 ? (distance(A, M) + distance(M, B)) / span : 1;
  let verdict = 'ok';
  if (near >= TWEEN.copyOther) verdict = 'copy';
  else if (near <= TWEEN.unchanged) verdict = 'unchanged';
  else if (excess > TWEEN.maxExcess) verdict = 'off';
  return { near: round2(near), excess: round2(excess), verdict };
}

const LETTERS = ['A', 'B', 'C', 'D'];

const VERDICT_TEXT = {
  copy: '照抄了另一格',
  unchanged: '和原来那一格一样，没改',
  off: '和前后两格都差得远，画走了样',
};

function round2(value) {
  return Math.round(value * 100) / 100;
}

// 从候选组图里切出画在第 cell 格的过渡格，对齐到原组图第 cell 格的人物上。fit 是别的格子量出来的整体偏移
// （见 layoutFit），这一格自己没对上时从那里开始细调。
function cutTween(origRgb, framing, candRgb, cell, fit) {
  const ref = framing.frames[cell - 1];
  const sx = candRgb.width / origRgb.width;
  const sy = candRgb.height / origRgb.height;
  const cx = (ref.x + ref.w / 2) * sx;
  const cy = (ref.y + ref.h / 2) * sy;
  const guess = fit ? { cx: cx + fit.dx(cx), cy: cy + fit.dy(cy) } : { cx, cy };
  const frame = alignAcross(origRgb, ref, candRgb, guess);
  return { frame, image: cropImage(candRgb, frame.x, frame.y, frame.w, frame.h) };
}

// 格子越往右、越往下，候选组图里的偏移越大（接口回的图比例不一样）：用对上了的格子拟合「偏移 = a × 位置 + b」。
function layoutFit(points) {
  const line = (xs, ys) => {
    if (!xs.length) return () => 0;
    const distinct = new Set(xs.map((x) => Math.round(x))).size;
    if (distinct < 2) {
      const mean = ys.reduce((s, v) => s + v, 0) / ys.length;
      return () => mean;
    }
    const n = xs.length;
    const mx = xs.reduce((s, v) => s + v, 0) / n;
    const my = ys.reduce((s, v) => s + v, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i += 1) {
      num += (xs[i] - mx) * (ys[i] - my);
      den += (xs[i] - mx) ** 2;
    }
    const slope = den > 1e-9 ? num / den : 0;
    return (x) => my + slope * (x - mx);
  };
  return {
    dx: line(points.map((p) => p.cx), points.map((p) => p.dx)),
    dy: line(points.map((p) => p.cy), points.map((p) => p.dy)),
  };
}

// 一张候选组图里所有过渡格：先各自对齐，没对上的按对上了的格子拟合出来的偏移重新对一次。
export function cutCandidate(origRgb, framing, keys, candRgb, assigned) {
  const sx = candRgb.width / origRgb.width;
  const sy = candRgb.height / origRgb.height;
  const results = new Map();
  for (const [cell, pair] of assigned) results.set(cell, { pair, ...cutTween(origRgb, framing, candRgb, cell, null) });
  const points = [...results.entries()]
    .filter(([, item]) => item.frame.matched)
    .map(([cell, item]) => {
      const ref = framing.frames[cell - 1];
      const cx = (ref.x + ref.w / 2) * sx;
      const cy = (ref.y + ref.h / 2) * sy;
      return { cx, cy, dx: item.frame.x + item.frame.w / 2 - cx, dy: item.frame.y + item.frame.h / 2 - cy };
    });
  if (points.length) {
    const fit = layoutFit(points);
    for (const [cell, item] of results) {
      if (item.frame.matched) continue;
      results.set(cell, { pair: item.pair, ...cutTween(origRgb, framing, candRgb, cell, fit) });
    }
  }
  for (const [cell, item] of results) {
    const other = item.pair.from === cell ? item.pair.to : item.pair.from;
    item.metrics = tweenMetrics(keys[cell - 1], keys[other - 1], item.image);
  }
  return results;
}

// ------------------------------------------------------------------ 提示词

function cleanText(value) {
  return String(value || '').replace(/[。；;，,\s]+$/, '').trim().slice(0, 300);
}

export function tweenPrompt(grid, assigned, problems) {
  const lines = [];
  for (let cell = 1; cell <= grid.count; cell += 1) {
    const pair = assigned.get(cell);
    if (!pair) {
      lines.push('第 ' + cell + ' 格：保持原样，不要改。');
      continue;
    }
    const problem = problems && problems.get(pair.key);
    lines.push('第 ' + cell + ' 格：' + cleanText(pair.text) + '。' + (problem ? '（上一版这一格的问题：' + cleanText(problem) + '。这次改正。）' : ''));
  }
  return (
    '这是一张 ' + grid.rows + ' 行 ' + grid.cols + ' 列的 ' + grid.count + ' 格组图，按从左到右、从上到下的顺序，是同一个主体一步一步的变化。' +
    '在这张图上改，画出每两格之间的过渡：每一格改成下面写的样子，只改主体在动的部分（表情、手和手臂、头的角度、身体的姿势）；' +
    '背景和背景里的东西、构图、主体在格子里的位置和大小、画风、线条和颜色都保持这一格原样；格子的排法和分隔线不变；' +
    '不要加文字、序号、箭头和水印。\n' + lines.join('\n')
  );
}

function stepLine(pair, index) {
  return '第 ' + (index + 1) + ' 步：第 ' + pair.from + ' 格 → 第 ' + pair.to + ' 格（画在第 ' + pair.cell + ' 格的位置上）';
}

function planPrompt(session, image, grid, pairs, sheetPath, gridPath, budget) {
  return [
    '你是H3-Image-Executor 的过渡格规划节点。用户要把一张分格组图拼成 GIF。格子之间一下一下地切换不够顺，',
    '系统要在相邻两格之间各补一格「中间状态」：在原组图上改一次，把每一格改成它和下一格中间的样子。你来写每一格要改成什么样。',
    '',
    '用户原话：',
    session.instruction,
    '',
    '这张图：' + (image.title || image.id) + '，' + grid.rows + ' 行 ' + grid.cols + ' 列共 ' + grid.count + ' 格，格子编号从上到下、从左到右数。',
    '看图材料：' + sheetPath + '（先用 read 打开它：每一格单独放大，左上角是格子编号）。看不清再打开原图：' + gridPath,
    '',
    '要补的步子（按播放顺序）：',
    ...pairs.map((pair, index) => '- ' + stepLine(pair, index)),
    '',
    '每一步写一句：画在那一格位置上的中间状态长什么样。',
    '- 写清每个在变的部位走到一半时的样子：表情（眉毛、眼睛、嘴型、眼泪）、手和手臂在哪、头的角度、身体的姿势。只写主体，',
    '  背景、构图和位置不用写，系统会要求保持那一格的原样。例：「双手握拳从胸前往上抬到下巴两侧，拳头刚要张开，还没贴到脸上；嘴张开大笑，眼睛开始发亮」。',
    '- 写成这一格完整的样子，不要写「和第几格一样」「介于两格之间」这种话：生图模型不会去看别的格子。',
    '- 两格不是同一个镜头里的连续动作（漫画换了场景、换了人物或机位），这一步写空字符串 ""，不补。',
    '- 不要让画面里出现文字、数字和序号。',
    '',
    '只输出一个 JSON 对象，不要解释、不要 markdown 代码块：',
    '{"seen":true,"between":["…","…"],"summary":"一句话"}',
    '- seen：打开看到了看图材料写 true；没看到写 false，between 留空。',
    '- between 的条数和上面的步子一样多、顺序一样。',
    '工具调用上限 ' + budget.limit + ' 次。',
  ].join('\n');
}

function reviewPrompt(session, image, rows, sheetPath, candidates, gridPath, budget) {
  return [
    '你是H3-Image-Executor 的过渡格评审节点。用户要把一张分格组图拼成 GIF，系统在相邻两格之间各补了一格中间状态',
    '（在原组图上改出来的，一次出了 ' + candidates.length + ' 张候选），你来给每一步挑最好的一格。',
    '',
    '用户原话：',
    session.instruction,
    '',
    '看图材料：' + sheetPath + '（先用 read 打开它，多数时候看它就够了）。每一行是一步：最左一张是前一格、最右一张是后一格（左上角是它们的格子编号），',
    '中间是各候选画的过渡格（左上角是候选字母 ' + LETTERS.slice(0, candidates.length).join('、') + '）。拼图上看不清，再打开候选原图（同样排法的整张组图）：',
    ...candidates.map((candidate, index) => '候选 ' + LETTERS[index] + ' -> ' + candidate.path),
    '原组图 -> ' + gridPath,
    '',
    '每一步要的中间状态：',
    ...rows.map((row, index) => {
      const notes = row.flags.map((flag, k) => (flag ? '候选 ' + LETTERS[k] + ' 程序判了' + flag + '，不要选' : '')).filter(Boolean);
      return '- 第 ' + (index + 1) + ' 步（第 ' + row.pair.from + ' 格 → 第 ' + row.pair.to + ' 格，画在第 ' + row.pair.cell + ' 格的位置上）：' + cleanText(row.pair.text) + (notes.length ? '；' + notes.join('；') : '');
    }),
    '',
    '逐步核对：',
    '1. 是同一个主体：脸、发型、服装、配色、画风和前后两格一样，没有变成另一个样子，没有多出或少了肢体、手指。',
    '2. 画的是两格中间的样子：在变的部位在前一格和后一格之间（有的部位已经变了、有的还没变也可以），不是照抄前一格或后一格，',
    '   没有往反方向走，也没有多出前后两格都没有的动作。',
    '3. 构图、主体在格子里的位置和大小、背景和它所在那一格一样：播放时插在两格中间，背景不会跳。',
    '4. 没有新加的文字、序号、箭头和水印。',
    '每一步从候选里挑一张最好的；都不合格就不挑。',
    '',
    '只输出一个 JSON 对象，不要解释、不要 markdown 代码块：',
    '{"seen":true,"steps":[{"step":1,"pick":"A","problem":""}],"summary":"一句话"}',
    '- seen：打开看到了看图材料写 true；没看到写 false，steps 留空，不要凭空判。',
    '- steps 里每一步写一项，step 是上面的步号，pick 是候选字母；都不合格写空字符串 ""，problem 写哪里不对（下一轮会照着改）。',
    '工具调用上限 ' + budget.limit + ' 次。',
  ].join('\n');
}

// ------------------------------------------------------------------ 主流程

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const SAFE = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/;
const RATIOS = ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9'];

function aspectFor(width, height) {
  const ratio = width / height;
  let best = 'auto';
  let bestError = 0.03;
  for (const item of RATIOS) {
    const [a, b] = item.split(':').map(Number);
    const error = Math.abs(a / b - ratio) / ratio;
    if (error < bestError) {
      bestError = error;
      best = item;
    }
  }
  return best;
}

// 过渡格只用在 GIF 里（最大 1024 像素）：2K 出图切出来的一格够 GIF 用就出 2K，比 4K 快一半。
function tweenArea(grid, framing, edge) {
  const aspect = grid.width / grid.height;
  const width2k = Math.sqrt(2048 * 2048 * aspect);
  const panel2k = (framing.width * width2k) / grid.width;
  const need = gifSize(framing.width, framing.height, edge).width;
  return panel2k >= need ? '2K' : '4K';
}

// 准备组图：切格、对齐，切好的每一格（GIF 用的取景）。不是组图、格子大小不一的排法返回 null。
export function prepareGrid(rgb, spec) {
  const detection = detectPanels(rgb, { rows: spec.rows, cols: spec.cols, count: spec.count });
  if (detection.count < 2) return null;
  const framing = framePanels(rgb, detection.cells, { align: spec.align !== false });
  if (framing.mode !== 'crop') return null;
  const keys = framing.frames.map((frame) => cropImage(rgb, frame.x, frame.y, frame.w, frame.h));
  return { detection, framing, keys, grid: { rows: detection.rows, cols: detection.cols, count: detection.count, width: rgb.width, height: rgb.height } };
}

function freshState(prev, sourceId) {
  return { sourceId, seq: (prev && prev.seq) || 0, rounds: 0, count: 0, state: '', pairs: [], reviews: [], note: '', planFailed: false, at: Date.now() };
}

// 这张组图需要补的过渡格都补上（已经补过、试过的不再补）。返回 image.panelTweens。
// options.mode：
//   make：在做 GIF（追问「变成 GIF」、规划时就要、组图改过了）：缺的都补；
//   adjust：只调了节奏（「慢一点」「去掉第 3 格」）：这张组图补过过渡格的，才把调整后多出来的步子补上，
//     没补过的（以前做的 GIF、用户说过不要补）不在这时候突然生图；
//   retry：用户说「更顺一点」：之前没补成的步子再试（还按每张组图最多两轮算）。
// hooks：executeAction、describeError、isFatal、isContentPolicy、isCancelled、lastDelivered、queuePixelWork。
export async function ensurePanelTweens(session, image, deps, hooks, options) {
  const opts = options || {};
  const mode = opts.mode || 'make';
  const spec = image.spec && image.spec.panelGif;
  const source = image.chosen || hooks.lastDelivered(session, image, deps);
  if (!spec || spec.smooth === false || !source || !source.path) return image.panelTweens || null;
  const own = image.panelTweens && image.panelTweens.sourceId === source.id ? image.panelTweens : null;
  if (mode === 'adjust' && !(own && own.pairs.some((pair) => pair.status === 'passed' || pair.status === 'unreviewed'))) return image.panelTweens || null;
  const state = own || freshState(image.panelTweens, source.id);
  image.panelTweens = state;
  if (mode === 'retry') {
    state.pairs = state.pairs.filter((pair) => pair.status === 'passed' || pair.status === 'unreviewed');
    state.rounds = 0;
    state.planFailed = false;
  }
  // 过渡格规划没跑成过：这张组图不再自动重试（每次追问都会走到这里），用户说「更顺一点」再试。
  if (state.planFailed) return state;
  // 已经知道这张组图有几格、要补的步子都补过或试过了：不用再解码 4K 的组图。
  if (state.count && tweenPairs(state.count, spec).every((pair) => state.pairs.some((one) => one.key === pair.key))) return state;
  let prepared;
  let rgb;
  try {
    rgb = await hooks.queuePixelWork(async () => toRgb(decodeImage(await readFile(source.path))));
    prepared = prepareGrid(rgb, spec);
  } catch (error) {
    state.note = '读不了组图：' + hooks.describeError(error);
    return state;
  }
  if (!prepared) return state;
  const { framing, keys, grid } = prepared;
  state.count = grid.count;
  const known = new Set(state.pairs.map((pair) => pair.key));
  const wanted = tweenPairs(grid.count, spec).filter((pair) => !known.has(pair.key));
  if (!wanted.length) return state;
  // 不是同一个镜头的两格不补：漫画换了场景，中间状态没有意义。
  const todo = [];
  for (const pair of wanted) {
    const change = changeShare(resizeArea(keys[pair.from - 1], 160, Math.max(1, Math.round((160 * framing.height) / framing.width))), resizeArea(keys[pair.to - 1], 160, Math.max(1, Math.round((160 * framing.height) / framing.width))));
    if (change > TWEEN.sceneChange) {
      state.pairs.push({ ...pair, cell: 0, text: '', status: 'skipped', problem: '两格不是同一个镜头（整幅变了 ' + Math.round(change * 100) + '%），不补', candidateFile: '' });
      continue;
    }
    todo.push(pair);
  }
  if (!todo.length) return state;
  if (state.rounds >= TWEEN.rounds) return state;
  const started = Date.now();
  deps.emit(session, 'paint', image.id + ' 补过渡格：相邻两格之间各补一格中间状态（' + todo.length + ' 步），一次画出一整张组图，从候选里挑');
  // 1. 写每一步怎么改
  const cellsFor = assignCells(todo);
  for (const [cell, pair] of cellsFor) pair.cell = cell;
  const planned = todo.filter((pair) => pair.cell);
  let texts;
  try {
    texts = await planTweens(session, image, deps, hooks, planned, prepared, source.path);
  } catch (error) {
    state.note = '没写出每一步怎么改（' + hooks.describeError(error) + '），这次不补';
    state.planFailed = true;
    deps.emit(session, 'paint', image.id + ' 过渡格没补：' + state.note, { level: 'warn' });
    return state;
  }
  if (hooks.isCancelled(session)) return state;
  if (!texts) {
    state.note = '过渡格规划没给出每一步怎么改，这次不补';
    state.planFailed = true;
    deps.emit(session, 'paint', image.id + ' 过渡格没补：' + state.note, { level: 'warn' });
    return state;
  }
  const pending = [];
  planned.forEach((pair, index) => {
    const value = cleanText(texts[index]);
    if (!value) {
      state.pairs.push({ ...pair, text: '', status: 'skipped', problem: '过渡格规划说这两格不是连续的动作，不补', candidateFile: '' });
      return;
    }
    pending.push({ ...pair, text: value, status: 'pending', problem: '', candidateFile: '', near: 0, excess: 0 });
  });
  // 2. 一轮一轮出图、挑
  const problems = new Map();
  while (pending.some((pair) => pair.status === 'pending') && state.rounds < TWEEN.rounds && !hooks.isCancelled(session)) {
    const open = pending.filter((pair) => pair.status === 'pending');
    const assigned = new Map(open.map((pair) => [pair.cell, pair]));
    state.rounds += 1;
    const round = await tweenRound(session, image, deps, hooks, { state, prepared, rgb, source, spec, assigned, problems });
    if (!round) break;
    for (const pair of open) {
      const pick = round.picks.get(pair.key);
      if (!pick) continue;
      Object.assign(pair, pick);
    }
    if (round.stopped) break;
  }
  for (const pair of pending) {
    if (pair.status === 'pending') {
      pair.status = 'failed';
      if (!pair.problem) pair.problem = problems.get(pair.key) || '没挑到能用的过渡格';
    }
    state.pairs.push(pair);
  }
  state.state = 'done';
  state.at = Date.now();
  const used = pending.filter((pair) => pair.status === 'passed' || pair.status === 'unreviewed');
  deps.emit(
    session,
    'paint',
    image.id + ' 过渡格补好了：' + used.length + '/' + pending.length + ' 步挑到了能用的' + (used.length < pending.length ? '，其余的两格之间直接切换' : ''),
    {
      durMs: Date.now() - started,
      level: used.length < pending.length ? 'warn' : 'info',
      detail: detail('过渡格 · ' + image.id, [
        list(
          '每一步',
          pending.map((pair) => ({
            tag: pair.status === 'passed' || pair.status === 'unreviewed' ? 'pass' : 'fail',
            text: '第 ' + pair.from + ' 格 → 第 ' + pair.to + ' 格：' + (pair.status === 'failed' ? pair.problem : '用 ' + pair.candidateId + (pair.status === 'unreviewed' ? '（评审没跑成，按程序量的挑）' : '')),
            note: pair.text,
          })),
        ),
      ]),
    },
  );
  return state;
}

// 过渡格规划：看着组图写每一步怎么改。返回和 pairs 一样长的数组；没写出来返回 null。
async function planTweens(session, image, deps, hooks, pairs, prepared, gridPath) {
  const { framing, keys, grid } = prepared;
  await deps.ensureDir(deps.dirs.sheets);
  const sheetPath = join(deps.dirs.sheets, image.id + '-tweenplan-' + Date.now() + '.png');
  const sheet = renderGridSheet(keys.map((key, i) => ({ image: key, label: String(i + 1) })), {
    perRow: grid.cols,
    width: Math.min(1800, grid.cols * 480),
    fill: 246,
    cellAspect: framing.width / framing.height,
  });
  await writeFile(sheetPath, encodePng(sheet, { level: 3 }));
  const budget = toolBudget('tweenplan', {
    needs: [{ count: 1, what: '看图材料' }, { count: 1, what: '原组图' }],
    difficulty: difficultyOf(image).level,
    hits: hitsOf(image, 'tweenplan'),
  });
  const result = await deps.agent.runJson(session, { step: 'tweenplan', instruction: planPrompt(session, image, grid, pairs, sheetPath, gridPath, budget), maxTools: budget.limit, budgetNote: budget.note });
  noteToolHit(image, 'tweenplan', result);
  const data = result && result.data;
  // 多写了的不要，少写了的整个不用：对不上是哪一步写的哪一句。
  if (!data || data.seen === false || !Array.isArray(data.between) || data.between.length < pairs.length) return null;
  return data.between.slice(0, pairs.length).map((value) => (typeof value === 'string' ? value : ''));
}

// 出一轮：在原组图上改一次（2 张候选），切出每一格过渡格、程序筛、评审挑。返回 { picks: Map(key → 结果), stopped }。
async function tweenRound(session, image, deps, hooks, ctx) {
  const { state, prepared, rgb, source, spec, assigned, problems } = ctx;
  const { framing, keys, grid } = prepared;
  const proxy = {
    id: image.id + 'T',
    spec: {
      aspectRatio: (image.spec.aspectRatio && image.spec.aspectRatio !== 'auto' ? image.spec.aspectRatio : '') || aspectFor(grid.width, grid.height),
      area: tweenArea(grid, framing, spec.edge),
      size: '',
      refs: [],
      characterRefs: [],
      candidates: TWEEN.candidates,
    },
    rounds: [{ index: 0 }],
    roundBase: state.seq,
  };
  state.seq += 1;
  deps.emit(session, 'paint', image.id + ' 过渡格第 ' + state.rounds + ' 轮：在 ' + source.id + ' 上一次改出 ' + assigned.size + ' 格（' + TWEEN.candidates + ' 张候选、' + proxy.spec.area + '）');
  let candidates;
  try {
    const mm = await h3.resolveReference(deps.config, source.path);
    const action = { type: 'edit', prompt: tweenPrompt(grid, assigned, problems), refs: [mm], parentId: null };
    candidates = await hooks.executeAction(session, proxy, action, deps);
  } catch (error) {
    const reason = hooks.describeError(error);
    for (const pair of assigned.values()) problems.set(pair.key, '这一轮没画出来：' + reason);
    deps.emit(session, 'paint', image.id + ' 过渡格没画出来：' + reason, { level: 'warn' });
    // 接口配置错误、内容审核拒绝：再出一轮也一样，停下。不记成会话失败：过渡格是附带的，GIF 照样交付，只是不补。
    if (hooks.isFatal(error) || hooks.isContentPolicy(error)) return { picks: new Map(), stopped: true };
    return { picks: new Map(), stopped: false };
  }
  if (!candidates.length) return { picks: new Map(), stopped: false };
  // 切格、对齐、量
  const cut = [];
  for (const candidate of candidates) {
    try {
      const candRgb = await hooks.queuePixelWork(async () => toRgb(decodeImage(candidate.buffer || (await readFile(candidate.path)))));
      if (Math.abs(candRgb.width / candRgb.height - grid.width / grid.height) / (grid.width / grid.height) > 0.04) {
        cut.push({ candidate, results: null, problem: '画幅和原组图不一样' });
        continue;
      }
      cut.push({ candidate, results: cutCandidate(rgb, framing, keys, candRgb, assigned) });
    } catch (error) {
      cut.push({ candidate, results: null, problem: '解不开：' + hooks.describeError(error) });
    }
  }
  // 每一步的候选和程序判断
  const rows = [];
  for (const [cell, pair] of assigned) {
    const flags = cut.map((item) => {
      if (!item.results) return item.problem || '解不开';
      const got = item.results.get(cell);
      return got && got.metrics.verdict !== 'ok' ? VERDICT_TEXT[got.metrics.verdict] : '';
    });
    rows.push({ cell, pair, flags });
  }
  const reviewable = rows.filter((row) => row.flags.some((flag) => !flag));
  const verdicts = reviewable.length ? await reviewTweens(session, image, deps, hooks, reviewable, cut, prepared, source.path) : null;
  const picks = new Map();
  for (const row of rows) {
    const usable = cut.map((item, k) => ({ item, k })).filter(({ k }) => !row.flags[k]);
    if (!usable.length) {
      problems.set(row.pair.key, row.flags.filter(Boolean)[0] || '没画出来');
      continue;
    }
    const verdict = verdicts && verdicts.get(row.pair.key);
    let chosen = null;
    let status = 'passed';
    if (verdict && verdict.pick > 0) {
      chosen = usable.find(({ k }) => k === verdict.pick - 1) || null;
      if (!chosen) {
        problems.set(row.pair.key, '评审挑的候选 ' + LETTERS[verdict.pick - 1] + ' 程序判了不能用');
        continue;
      }
    } else if (verdict && verdict.pick === 0) {
      problems.set(row.pair.key, verdict.problem || '评审判两张候选都不合格');
      continue;
    } else {
      // 评审没跑成：挑程序量出来最像中间状态的（near 最接近 0.5，走样最少）。
      status = 'unreviewed';
      chosen = usable
        .map((entry) => ({ ...entry, metrics: entry.item.results.get(row.cell).metrics }))
        .sort((x, y) => Math.abs(x.metrics.near - 0.5) - Math.abs(y.metrics.near - 0.5) || x.metrics.excess - y.metrics.excess)[0];
    }
    const got = chosen.item.results.get(row.cell);
    picks.set(row.pair.key, {
      status,
      problem: '',
      candidateId: chosen.item.candidate.id,
      candidateFile: chosen.item.candidate.file,
      near: got.metrics.near,
      excess: got.metrics.excess,
    });
  }
  return { picks, stopped: false };
}

// 过渡格评审：一张对比图，每一行一步：前一格、各候选、后一格。返回 Map(key → { pick, problem })；没跑成返回 null。
async function reviewTweens(session, image, deps, hooks, rows, cut, prepared, gridPath) {
  const { framing, keys } = prepared;
  const cellW = TWEEN.sheetCell;
  const cellH = Math.max(1, Math.round((cellW * framing.height) / framing.width));
  const blank = { width: cellW, height: cellH, channels: 3, data: Buffer.alloc(cellW * cellH * 3, 200) };
  const entries = [];
  for (const row of rows) {
    entries.push({ image: renderPanel(keys[row.pair.from - 1], { x: 0, y: 0, w: framing.width, h: framing.height }, cellW, cellH, {}), label: String(row.pair.from) });
    cut.forEach((item, k) => {
      const got = item.results && item.results.get(row.cell);
      entries.push({ image: got ? renderPanel(got.image, { x: 0, y: 0, w: got.image.width, h: got.image.height }, cellW, cellH, {}) : blank, label: LETTERS[k] });
    });
    entries.push({ image: renderPanel(keys[row.pair.to - 1], { x: 0, y: 0, w: framing.width, h: framing.height }, cellW, cellH, {}), label: String(row.pair.to) });
  }
  await deps.ensureDir(deps.dirs.sheets);
  const sheetPath = join(deps.dirs.sheets, image.id + '-tweens-' + Date.now() + '.png');
  const perRow = cut.length + 2;
  await writeFile(sheetPath, encodePng(renderGridSheet(entries, { perRow, width: perRow * cellW, fill: 246, cellAspect: cellW / cellH }), { level: 3 }));
  const budget = toolBudget('tweens', {
    needs: [{ count: 1, what: '对比图' }, { count: Math.ceil(cut.length / 2), what: '候选原图' }],
    difficulty: difficultyOf(image).level,
    hits: hitsOf(image, 'tweens'),
  });
  const started = Date.now();
  let data;
  try {
    const reviewed = await deps.agent.runJson(session, {
      step: 'tweens',
      instruction: reviewPrompt(session, image, rows, sheetPath, cut.map((item) => item.candidate), gridPath, budget),
      maxTools: budget.limit,
      budgetNote: budget.note,
    });
    noteToolHit(image, 'tweens', reviewed);
    data = reviewed && reviewed.data;
  } catch (error) {
    deps.emit(session, 'judge', image.id + ' 过渡格评审没跑成：' + hooks.describeError(error) + '，按程序量的挑', { level: 'warn' });
    return null;
  }
  if (!data || data.seen === false || !Array.isArray(data.steps)) {
    deps.emit(session, 'judge', image.id + ' 过渡格评审没看到图，按程序量的挑', { level: 'warn', durMs: Date.now() - started });
    return null;
  }
  const out = new Map();
  rows.forEach((row, index) => {
    const verdict = data.steps.find((one) => one && Number(one.step) === index + 1);
    if (!verdict) return;
    // pick 写字母（也认数字：1 是 A）；空的、0、认不出的都当没挑。
    const raw = String(verdict.pick == null ? '' : verdict.pick).trim().toUpperCase();
    const pick = LETTERS.indexOf(raw) >= 0 ? LETTERS.indexOf(raw) + 1 : /^\d+$/.test(raw) ? Number(raw) : 0;
    out.set(row.pair.key, { pick: pick >= 0 && pick <= cut.length ? pick : 0, problem: String(verdict.problem || '').trim().slice(0, 200) });
  });
  const picked = [...out.values()].filter((one) => one.pick > 0).length;
  deps.emit(session, 'judge', image.id + ' 过渡格评审：' + picked + '/' + rows.length + ' 步挑到了', {
    durMs: Date.now() - started,
    level: picked < rows.length ? 'warn' : 'info',
    detail: detail('过渡格评审 · ' + image.id, [
      list('每一步', rows.map((row, index) => {
        const one = out.get(row.pair.key);
        return { tag: one && one.pick ? 'pass' : 'fail', text: '第 ' + (index + 1) + ' 步（' + row.pair.from + ' → ' + row.pair.to + '）：' + (one ? (one.pick ? '用候选 ' + LETTERS[one.pick - 1] : one.problem || '都不合格') : '没给结论') };
      })),
      data.summary ? text('总结', String(data.summary).slice(0, 300)) : null,
      kv('对比图', basename(sheetPath)),
    ]),
  });
  return out;
}

// ------------------------------------------------------------------ 合成用

// 拼 GIF 时要用的过渡格：Map(key → { image: 对齐好的那一格, cell: 画在哪一格上 })。从候选组图里重新切（切法改了也跟着变）。
export async function loadTweens(image, source, rgb, prepared, deps) {
  const state = image.panelTweens;
  const out = new Map();
  if (!state || state.sourceId !== source.id || !prepared) return out;
  const usable = state.pairs.filter((pair) => (pair.status === 'passed' || pair.status === 'unreviewed') && pair.cell && SAFE.test(String(pair.candidateFile || '')));
  const byFile = new Map();
  for (const pair of usable) byFile.set(pair.candidateFile, (byFile.get(pair.candidateFile) || []).concat([pair]));
  for (const [file, pairs] of byFile) {
    const path = join(deps.dirs.images, file);
    if (!(await exists(path))) continue;
    const candRgb = toRgb(decodeImage(await readFile(path)));
    const assigned = new Map(pairs.map((pair) => [pair.cell, pair]));
    const results = cutCandidate(rgb, prepared.framing, prepared.keys, candRgb, assigned);
    for (const [cell, item] of results) out.set(item.pair.key, { image: item.image, cell });
  }
  return out;
}

export function tweenSignature(image, sourceId) {
  const state = image.panelTweens;
  if (!state || state.sourceId !== sourceId) return '';
  return state.pairs
    .filter((pair) => pair.status === 'passed' || pair.status === 'unreviewed')
    .map((pair) => pair.key + ':' + pair.candidateFile + '@' + pair.cell)
    .sort()
    .join(',');
}

// 落盘：文件只存文件名。
export function snapshotTweens(state) {
  if (!state || typeof state !== 'object') return null;
  return JSON.parse(JSON.stringify(state));
}

export function restoreTweens(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.pairs)) return null;
  const out = JSON.parse(JSON.stringify(raw));
  out.seq = Number(raw.seq) || 0;
  out.rounds = Number(raw.rounds) || 0;
  out.count = Number(raw.count) || 0;
  out.planFailed = Boolean(raw.planFailed);
  out.pairs = raw.pairs
    .filter((pair) => pair && typeof pair.key === 'string' && /^\d+-\d+$/.test(pair.key))
    .map((pair) => ({
      ...pair,
      from: Number(pair.from) || 0,
      to: Number(pair.to) || 0,
      cell: Number(pair.cell) || 0,
      candidateFile: SAFE.test(String(pair.candidateFile || '')) ? pair.candidateFile : '',
      // 补到一半应用被关掉了：没挑完的步子下次再补。
      status: pair.status === 'pending' ? 'failed' : String(pair.status || 'failed'),
    }));
  return out;
}

