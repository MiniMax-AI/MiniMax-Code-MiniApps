// 拼 GIF、读回核对。两种来源：
//   组图切出来的各格（panels.mjs）：按节奏排成一组帧：每格停多久、第一格和最后一格停久一点、可以来回播，
//   要的话切换时轻微弹一下（panelTimeline、renderTimeline、buildPanelGif）；
//   一组现成的帧：Agent 写程序画的（tools/h3-gif.mjs frames）。
// 编码交给 gif.mjs：所有帧共用一套调色板，同一种颜色每一帧都是同一个色号，不会一帧一跳；每帧时长可以不一样。
// 写完从字节读回来逐帧核对帧数、时长、循环和画面（verifyGif），核对过了才算做成。
// 做法参考 jungle-adventure 和 david-voxel-loop 两个例子：模型只出静态图，动起来全靠程序；全组一套调色板；
// 循环播放时首尾要接得上（最后一帧接回第一帧也是一步）；写完读回来核对，再出一张帧拼图给人看一眼。
import { changeShare, decodeGif, fitFrame, gifSize, lockToBase, makeGif, resizeArea, toRgb } from './gif.mjs';
import { detectPanels, framePanels, renderPanel } from './panels.mjs';
import { locateSpin, normalizeSpin, spinFrame } from './motion.mjs';
import { renderGridSheet } from './review.mjs';

export const RHYTHM = {
  frameMs: 700,
  // 第一格停久一点看清起点，最后一格停得更久看清结果，再接回第一格。
  firstScale: 1.5,
  lastScale: 2,
  minMs: 60,
  maxMs: 5000,
  // 切换时轻微弹一下（spec.bounce 为 true 才加）：新的一格先放大 3% 停 0.08 秒，再落回原大小。时间从这一格的停留里扣，整组时长不变。
  // 以前默认加，真机 20261119-250f55 看着是「每次切换都跳一下」：各格对齐以后头和背景本来一动不动，放大的那一帧让整幅画面
  // 先往外扩 11 像素、头往上跳 9 像素，0.08 秒后又弹回，一次切换动两下。所以默认不加，用户点名要才加。
  // 只放一帧：放大的帧每个像素都变，一帧就是几十 KB（db1dd9 六格拼成 768 像素：不弹 388 KB，弹一帧 756 KB，弹两帧约 1.1 MB）。
  pop: [{ zoom: 1.03, ms: 80 }],
  // 渐变：两格之间叠两帧。两格差得多时叠出来是两个半透明的样子（真机 20261117-21581a 的虚影），所以默认直接切换。
  fade: { steps: 2, ms: 70 },
  edge: 768,
  // 和当前画面差得很少的像素沿用上一帧：各格里同一片背景不会一格一格地闪。
  stabilize: 8,
  // 过渡格（见 paneltween.mjs）停多久：每格停留时间的这么多，80–240 毫秒。
  tweenShare: 0.25,
  tweenMinMs: 80,
  tweenMaxMs: 240,
};

// 两格之间的过渡格用这个当名字：不分先后，往前播、往回播用的是同一格。
export function pairKey(a, b) {
  return Math.min(a, b) + '-' + Math.max(a, b);
}

export function tweenMsFor(frameMs) {
  return Math.max(RHYTHM.tweenMinMs, Math.min(RHYTHM.tweenMaxMs, Math.round((frameMs * RHYTHM.tweenShare) / 10) * 10));
}

// 读回核对的门槛：每一帧和要写的画面平均差不超过 meanDiff 级（调色板量化、沿用上一帧的像素都在这里面），
// 差 outlierDiff 级以上的像素不超过 outlierShare。
export const VERIFY = { meanDiff: 6, outlierDiff: 48, outlierShare: 0.005 };

export function clampMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(Math.max(RHYTHM.minMs, Math.min(RHYTHM.maxMs, n)));
}

// ------------------------------------------------------------------ 组图的节奏

// spec：{ order, drop, frameMs, firstMs, lastMs, hold:[{index,ms}], loop, pingpong, transition, bounce, tweens }，order、drop 和 hold 的 index
// 都是格子编号（从 1 起，从上到下、从左到右数）。order 不写按编号顺序，drop 里的格子不放。bounce 写 true 才弹（见 RHYTHM.pop）。
// tweens：有过渡格的两格（paneltween.pairKey 的写法，'2-3'）。有过渡格的那一步，前一格停够之后先放过渡格（时间从前一格里扣），
// 再到后一格，不再弹一下、也不叠渐变。
// 返回 { order, holds, turn（往前播的最后一格在 order 里的位置）, steps:[{ kind:'key'|'pop'|'fade', panel, ms, zoom, to, t }], durationMs, transition, bounce, loop }。
// GIF 的第一帧是第一格本身：很多地方拿第一帧当封面。循环播放时第一格进场的那一下弹，放在最后、接回开头之前。
export function panelTimeline(count, spec) {
  const s = spec || {};
  const loop = s.loop !== false;
  const dropped = new Set((Array.isArray(s.drop) ? s.drop : []).map(Number));
  let order = (Array.isArray(s.order) && s.order.length ? s.order : range(1, count))
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= count && !dropped.has(n));
  order = order.filter((n, i) => i === 0 || n !== order[i - 1]);
  if (loop && order.length > 2 && order[0] === order[order.length - 1]) order.pop();
  if (order.length < 2) throw new Error('panel_order_too_short');
  // 「最后一格」是往前播的最后一格：来回播时是掉头的那一格。
  const turn = order.length - 1;
  if (s.pingpong && order.length > 2) order = order.concat(order.slice(1, -1).reverse());
  const frameMs = clampMs(s.frameMs) || RHYTHM.frameMs;
  const custom = new Map((Array.isArray(s.hold) ? s.hold : []).map((item) => [Number(item.index), clampMs(item.ms)]).filter((pair) => pair[1]));
  const holds = order.map((panel, i) => {
    if (custom.has(panel)) return custom.get(panel);
    if (i === 0) return clampMs(s.firstMs) || Math.round(frameMs * RHYTHM.firstScale);
    if (i === turn) return clampMs(s.lastMs) || Math.round(frameMs * RHYTHM.lastScale);
    return frameMs;
  });
  const transition = s.transition === 'fade' ? 'fade' : 'cut';
  const bounce = transition === 'cut' && s.bounce === true;
  const popMs = RHYTHM.pop.reduce((sum, item) => sum + item.ms, 0);
  const fadeMs = RHYTHM.fade.steps * RHYTHM.fade.ms;
  const tweenSet = new Set(Array.isArray(s.tweens) ? s.tweens : []);
  const tweenMs = tweenMsFor(frameMs);
  const steps = [];
  let leadPops = [];
  let tweens = 0;
  order.forEach((panel, i) => {
    let hold = holds[i];
    const next = i + 1 < order.length ? order[i + 1] : loop ? order[0] : 0;
    // 停留太短的格子不弹、不渐变、不放过渡格：扣完时间只剩一闪，反而看不清。
    const tween = next && next !== panel && tweenSet.has(pairKey(panel, next)) && hold - tweenMs >= hold / 2;
    // 后一格前面有过渡格的，切过去的那一下已经是一步一步的了：不再弹。
    const prev = i > 0 ? order[i - 1] : loop ? order[order.length - 1] : 0;
    const arrivedByTween = prev && prev !== panel && tweenSet.has(pairKey(prev, panel));
    const pops = [];
    if (bounce && !arrivedByTween && (i > 0 || loop) && hold - popMs >= hold / 2) {
      for (const item of RHYTHM.pop) pops.push({ kind: 'pop', panel, zoom: item.zoom, ms: item.ms });
      hold -= popMs;
    }
    const after = [];
    if (tween) {
      after.push({ kind: 'tween', panel, to: next, key: pairKey(panel, next), ms: tweenMs, zoom: 1 });
      hold -= tweenMs;
      tweens += 1;
    } else if (transition === 'fade' && next && next !== panel && hold - fadeMs >= hold / 2) {
      for (let k = 1; k <= RHYTHM.fade.steps; k += 1) after.push({ kind: 'fade', panel, to: next, t: k / (RHYTHM.fade.steps + 1), ms: RHYTHM.fade.ms, zoom: 1 });
      hold -= fadeMs;
    }
    if (i === 0) leadPops = pops;
    else steps.push(...pops);
    steps.push({ kind: 'key', panel, ms: hold, zoom: 1 });
    steps.push(...after);
  });
  steps.push(...leadPops);
  return { order, holds, turn, steps, durationMs: steps.reduce((sum, step) => sum + step.ms, 0), transition, bounce, loop, tweens, tweenMs };
}

// 按节奏出每一帧（GIF 尺寸的 RGB）。source(panel) 给出这一格取自哪张图的哪一块：{ image, frame, mode }。
// tweens：Map(pairKey → { image, cell })，image 是已经对齐成和格子一样取景的过渡格，cell 是它画在哪一格上：
// 锁到那一格上，背景用那一格的像素，只留下真正在动的部位（见 gif.lockToBase）。同一格同一个缩放只出一次。
export function renderTimeline(source, steps, size, tweens) {
  const cache = new Map();
  const panelAt = (panel, zoom) => {
    const key = panel + '@' + zoom;
    if (!cache.has(key)) {
      const from = source(panel);
      cache.set(key, renderPanel(from.image, from.frame, size.width, size.height, { zoom, mode: from.mode }));
    }
    return cache.get(key);
  };
  const tweenAt = (key) => {
    const name = 'tween:' + key;
    if (!cache.has(name)) {
      const { image, cell } = tweens.get(key);
      const drawn = renderPanel(image, { x: 0, y: 0, w: image.width, h: image.height }, size.width, size.height, {});
      cache.set(name, cell ? lockToBase(drawn, panelAt(cell, 1), 0.9).frame : drawn);
    }
    return cache.get(name);
  };
  return steps.map((step) => {
    if (step.kind === 'fade') return blend(panelAt(step.panel, 1), panelAt(step.to, 1), step.t);
    if (step.kind === 'tween') return tweenAt(step.key);
    return panelAt(step.panel, step.zoom || 1);
  });
}

function blend(a, b, t) {
  const out = Buffer.alloc(a.data.length);
  for (let i = 0; i < out.length; i += 1) out[i] = Math.round(a.data[i] + (b.data[i] - a.data[i]) * t);
  return { width: a.width, height: a.height, channels: 3, data: out };
}

function edgeOf(spec) {
  return Math.max(64, Math.min(2048, Math.round(Number(spec && spec.edge) || RHYTHM.edge)));
}

// 一张组图 → GIF。spec 见 panelTimeline，另有 rows / cols / count（切格的提示）、edge（GIF 长边）、align（是否对齐各格）。
// extras.tweens：Map(pairKey → { image, cell })，见 paneltween.loadTweens。
// 切不出两格以上时抛 not_grid。返回切格结果、取景、节奏、编码结果、核对结果和帧条。
export function buildPanelGif(image, spec, extras) {
  const s = spec || {};
  const rgb = toRgb(image);
  const detection = detectPanels(rgb, { rows: s.rows, cols: s.cols, count: s.count });
  if (detection.count < 2) {
    const error = new Error('not_grid');
    error.detection = detection;
    throw error;
  }
  const framing = framePanels(rgb, detection.cells, { align: s.align !== false });
  const size = gifSize(framing.width, framing.height, edgeOf(s));
  const tweens = framing.mode === 'crop' && extras && extras.tweens instanceof Map ? extras.tweens : new Map();
  const built = assemble(detection.count, { ...s, tweens: [...tweens.keys()] }, size, (panel) => ({ image: rgb, frame: framing.frames[panel - 1], mode: framing.mode }), tweens);
  return { detection, framing, ...built };
}

// 几张单独的图 → GIF（四张一组的漫画、一组表情）：每张就是一格，按第一张的画幅统一大小。
// 画幅差得不多的居中裁一点；差得多的整张缩进画幅、四周补这张图边上的底色。各张构图本来就不同，不对齐。
export function buildSlidesGif(images, spec) {
  const s = spec || {};
  if (!Array.isArray(images) || images.length < 2) throw new Error('slides_need_two');
  const rgbs = images.map((image) => toRgb(image));
  const aspect = rgbs[0].width / rgbs[0].height;
  const mixed = rgbs.some((image) => Math.abs(image.width / image.height - aspect) / aspect > 0.12);
  const frames = rgbs.map((image) => {
    if (mixed) return { x: 0, y: 0, w: image.width, h: image.height };
    const current = image.width / image.height;
    const w = current > aspect ? Math.round(image.height * aspect) : image.width;
    const h = current > aspect ? image.height : Math.round(image.width / aspect);
    return { x: Math.floor((image.width - w) / 2), y: Math.floor((image.height - h) / 2), w, h };
  });
  const size = gifSize(rgbs[0].width, rgbs[0].height, edgeOf(s));
  const built = assemble(rgbs.length, s, size, (panel) => ({ image: rgbs[panel - 1], frame: frames[panel - 1], mode: mixed ? 'fit' : 'crop' }));
  return { framing: { mode: mixed ? 'fit' : 'crop', width: size.width, height: size.height, frames }, ...built };
}

// 排节奏、出帧、编码、核对，再把各格按第一次出场的顺序排成帧条（标格子编号；补的过渡格跟在前一格后面，标「格子号+」）。
function assemble(count, spec, size, source, tweens) {
  const timeline = panelTimeline(count, spec);
  const frames = renderTimeline(source, timeline.steps, size, tweens || new Map());
  const { gif, verify } = encodeFrames(frames, { width: size.width, height: size.height, delays: timeline.steps.map((step) => step.ms), loop: timeline.loop });
  const shown = timeline.order.filter((panel, i) => timeline.order.indexOf(panel) === i);
  const firstFrame = new Map();
  timeline.steps.forEach((step, i) => {
    const name = step.kind === 'key' ? 'k' + step.panel : step.kind === 'tween' ? 't' + step.key : '';
    if (name && !firstFrame.has(name)) firstFrame.set(name, { frame: frames[i], step });
  });
  const entries = [];
  for (const panel of shown) {
    entries.push({ image: firstFrame.get('k' + panel).frame, label: String(panel) });
    const tween = [...firstFrame.values()].find((item) => item.step.kind === 'tween' && item.step.panel === panel);
    if (tween) entries.push({ image: tween.frame, label: panel + '+' });
  }
  const strip = contactSheet(
    entries,
    // 每行最多 6 格，行与行尽量一样长：8 格排成 4+4，不排成 6+2。
    { perRow: Math.ceil(entries.length / Math.ceil(entries.length / 6)), width: 1200, fill: 246, cellAspect: size.width / size.height },
  );
  return { timeline, size, gif, verify, strip, shown };
}

// ------------------------------------------------------------------ 程序转圈

// 一张图 → 绕圆心转的 GIF（见 motion.mjs）。spec：{ spin:{ center, radius, steps, frames, direction, refine }, frameMs, loop, transition, edge }。
// 一格一格跑的（steps）默认每格 80 毫秒、两格之间叠一帧渐变（亮点从一个点淡到下一个点）；连续转的默认每帧 50 毫秒、直接切换。
// 每帧转的角度是 360°/帧数，最后一帧再转一格正好是第一帧：首尾天然接得上。
export function buildSpinGif(image, spec) {
  const s = spec || {};
  const spin = normalizeSpin(s.spin || {});
  const rgb = toRgb(image);
  const where = locateSpin(rgb, spin);
  const size = gifSize(rgb.width, rgb.height, edgeOf(s));
  // 在 GIF 两倍大的图上转，再缩回 GIF 尺寸：转的时候取样的锯齿，缩小以后看不出来。
  const scale = Math.min(1, (2 * Math.max(size.width, size.height)) / Math.max(rgb.width, rgb.height));
  const work = scale < 1 ? resizeArea(rgb, Math.max(1, Math.round(rgb.width * scale)), Math.max(1, Math.round(rgb.height * scale))) : rgb;
  const k = work.width / rgb.width;
  const count = spin.steps || spin.frames;
  const sign = spin.direction === 'ccw' ? -1 : 1;
  const keys = [];
  for (let i = 0; i < count; i += 1) {
    const turned = i ? spinFrame(work, where.cx * k, where.cy * k, where.radius * k, (sign * 2 * Math.PI * i) / count) : work;
    keys.push(resizeArea(turned, size.width, size.height));
  }
  const loop = s.loop !== false;
  const frameMs = clampSpinMs(s.frameMs) || (spin.steps ? 80 : 50);
  const fade = s.transition === 'fade' || (!s.transition && spin.steps > 0);
  const frames = [];
  const delays = [];
  for (let i = 0; i < count; i += 1) {
    const next = i + 1 < count ? keys[i + 1] : loop ? keys[0] : null;
    // GIF 的时长以 10 毫秒为单位：渐变帧和定格帧都取 10 的倍数、至少 20 毫秒，一格的时长才和写的一样。
    const blends = frameMs >= 120 ? 2 : 1;
    const part = Math.round(frameMs / (blends + 1) / 10) * 10;
    if (!fade || !next || part < 20 || frameMs - blends * part < 20) {
      frames.push(keys[i]);
      delays.push(frameMs);
      continue;
    }
    frames.push(keys[i]);
    delays.push(frameMs - blends * part);
    for (let b = 1; b <= blends; b += 1) {
      frames.push(blend(keys[i], next, b / (blends + 1)));
      delays.push(part);
    }
  }
  const { gif, verify } = encodeFrames(frames, { width: size.width, height: size.height, delays, loop });
  // 帧条最多放 12 格：一格一格跑的放前 12 格，连续转的均匀取 12 帧。
  const picks = [];
  const shown = Math.min(12, count);
  for (let i = 0; i < shown; i += 1) picks.push(Math.round((i * count) / shown));
  const strip = contactSheet(
    picks.map((index) => ({ image: keys[index], label: String(index + 1) })),
    { perRow: Math.ceil(picks.length / Math.ceil(picks.length / 6)), width: 1200, fill: 246, cellAspect: size.width / size.height },
  );
  return { spin, where, size, gif, verify, strip, count, frameMs, fade, loop };
}

// 转圈的每帧可以很短：连续转每帧 40 毫秒（25 帧每秒）才顺。GIF 的时长以 10 毫秒为单位，短于 20 毫秒的帧浏览器会按 100 毫秒播。
export function clampSpinMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(Math.max(20, Math.min(2000, n)));
}

// ------------------------------------------------------------------ 编码与核对

// frames：同样大小的 RGB 帧；delays：每帧毫秒数。stabilize 给 0 时逐像素精确（程序画的帧），不给用 RHYTHM.stabilize。
export function encodeFrames(input, options) {
  const opts = options || {};
  const width = opts.width || input[0].width;
  const height = opts.height || input[0].height;
  // 尺寸不对的帧先缩好：核对要拿写进去的那一版比，不能拿缩之前的。
  const frames = input.map((frame) => fitFrame(frame, width, height));
  const gifOptions = { width, height, delays: opts.delays, loop: opts.loop !== false, matchTone: false, tween: 0, stabilize: Number.isFinite(opts.stabilize) ? opts.stabilize : RHYTHM.stabilize };
  if (opts.dither) gifOptions.dither = opts.dither;
  if (Number.isFinite(opts.colors)) gifOptions.colors = Math.max(2, Math.min(255, Math.round(opts.colors)));
  const gif = makeGif(frames, gifOptions);
  const verify = verifyGif(gif.buffer, { frames, delays: opts.delays, loop: opts.loop !== false, changed: gif.changed, width, height });
  return { gif, verify, frames };
}

// 从写出去的字节读回来核对：尺寸、帧数、每帧时长、循环，以及每一帧的画面和要写的画面差多少。
// 和上一帧一模一样的帧 gif.mjs 会并进上一帧的时长里（changed 为 0），核对时同样合并。
export function verifyGif(buffer, expected) {
  const problems = [];
  let back;
  try {
    back = decodeGif(buffer);
  } catch (error) {
    return { ok: false, frames: 0, width: 0, height: 0, durationMs: 0, loop: false, maxMeanDiff: 0, outlierShare: 0, problems: ['读不回来：' + (error && error.message ? error.message : error)] };
  }
  const want = [];
  expected.frames.forEach((frame, i) => {
    const ms = Math.max(20, Math.round((expected.delays && expected.delays[i]) || 0));
    if (i > 0 && expected.changed && expected.changed[i] === 0) {
      want[want.length - 1].ms += ms;
      return;
    }
    want.push({ frame, ms });
  });
  if (back.width !== expected.width || back.height !== expected.height) problems.push('尺寸 ' + back.width + '×' + back.height + '，应为 ' + expected.width + '×' + expected.height);
  if (back.frames.length !== want.length) problems.push('读回 ' + back.frames.length + ' 帧，应为 ' + want.length + ' 帧');
  const loop = back.loop === 0;
  if (expected.loop !== loop) problems.push(expected.loop ? '没写循环播放' : '写成了循环播放');
  let maxMeanDiff = 0;
  let outlierShare = 0;
  const badDelays = [];
  const badFrames = [];
  const n = Math.min(back.frames.length, want.length);
  for (let i = 0; i < n; i += 1) {
    const cs = Math.max(2, Math.round(want[i].ms / 10));
    if (back.frames[i].delayMs !== cs * 10) badDelays.push(i + 1);
    const diff = frameDiff(back.frames[i].image, want[i].frame);
    maxMeanDiff = Math.max(maxMeanDiff, diff.mean);
    outlierShare = Math.max(outlierShare, diff.outliers);
    if (diff.mean > VERIFY.meanDiff || diff.outliers > VERIFY.outlierShare) badFrames.push(i + 1);
  }
  if (badDelays.length) problems.push('第 ' + badDelays.join('、') + ' 帧的时长和要写的不一样');
  if (badFrames.length) problems.push('第 ' + badFrames.join('、') + ' 帧读回来的画面和要写的差太多');
  return {
    ok: problems.length === 0,
    frames: back.frames.length,
    width: back.width,
    height: back.height,
    durationMs: back.frames.reduce((sum, frame) => sum + frame.delayMs, 0),
    loop,
    maxMeanDiff: Math.round(maxMeanDiff * 100) / 100,
    outlierShare: Math.round(outlierShare * 10000) / 10000,
    problems,
  };
}

function frameDiff(a, b) {
  const n = Math.min(a.width * a.height, b.width * b.height);
  let sum = 0;
  let outliers = 0;
  for (let p = 0; p < n; p += 1) {
    const s = p * 3;
    const dr = Math.abs(a.data[s] - b.data[s]);
    const dg = Math.abs(a.data[s + 1] - b.data[s + 1]);
    const db = Math.abs(a.data[s + 2] - b.data[s + 2]);
    sum += dr + dg + db;
    if (Math.max(dr, dg, db) > VERIFY.outlierDiff) outliers += 1;
  }
  return { mean: n ? sum / (n * 3) : 0, outliers: n ? outliers / n : 0 };
}

// 看一个现成的 GIF：帧数、时长、循环，相邻两帧变了多少，以及循环时最后一帧接回第一帧那一步（接缝）。
// 接缝比中间最大的一步还大不少，播到那里会跳一下；首尾两帧完全一样，接缝处等于多停了一帧。
// 「步子多大」在缩成 64 像素宽、再模糊两档的灰度图上量平均差。只数变了多少像素不行：小物体挪一步和从画面一头
// 跳回另一头，变的都是两个整圆；糊开以后两团叠在一起，挪得越远差得越多。
export function inspectGif(buffer) {
  const back = decodeGif(buffer);
  const images = back.frames.map((frame) => frame.image);
  const steps = [];
  for (let i = 0; i + 1 < images.length; i += 1) steps.push(round3(changeShare(images[i], images[i + 1])));
  const looped = back.loop !== null && images.length > 1;
  const last = images[images.length - 1];
  let seam = null;
  if (looped) {
    const base = images.map((image) => grayThumb(image, 64));
    const scales = [0.02, 0.15].map((sigma) => seamAt(base.map((thumb) => blurThumb(thumb, sigma)), sigma));
    seam = {
      change: round3(changeShare(last, images[0])),
      motion: round2(scales[1].seam),
      widestStep: round2(scales[1].widest),
      identicalEnds: Buffer.compare(last.data, images[0].data) === 0,
      jump: scales.some((item) => item.seam > Math.max(0.3, item.widest * 1.3)),
    };
  }
  return {
    width: back.width,
    height: back.height,
    frames: images.length,
    delays: back.frames.map((frame) => frame.delayMs),
    durationMs: back.frames.reduce((sum, frame) => sum + frame.delayMs, 0),
    loop: back.loop,
    steps,
    seam,
    images,
  };
}

function seamAt(thumbs) {
  let widest = 0;
  for (let i = 0; i + 1 < thumbs.length; i += 1) widest = Math.max(widest, meanDiff(thumbs[i].data, thumbs[i + 1].data));
  return { seam: meanDiff(thumbs[thumbs.length - 1].data, thumbs[0].data), widest };
}

function grayThumb(image, width) {
  const w = Math.max(1, Math.min(width, image.width));
  const h = Math.max(1, Math.round((w * image.height) / image.width));
  const small = resizeArea(image, w, h).data;
  const data = new Float32Array(w * h);
  for (let p = 0; p < data.length; p += 1) data[p] = 0.299 * small[p * 3] + 0.587 * small[p * 3 + 1] + 0.114 * small[p * 3 + 2];
  return { width: w, height: h, data };
}

// 三遍方框模糊近似高斯，sigma 按宽度的比例给。
function blurThumb(thumb, sigma) {
  const r = Math.max(1, Math.round((sigma * thumb.width) / 1.7));
  let data = thumb.data;
  for (let pass = 0; pass < 3; pass += 1) data = boxPass(boxPass(data, thumb.width, thumb.height, r, true), thumb.width, thumb.height, r, false);
  return { width: thumb.width, height: thumb.height, data };
}

function boxPass(src, w, h, r, horizontal) {
  const out = new Float32Array(src.length);
  const lines = horizontal ? h : w;
  const length = horizontal ? w : h;
  const at = (line, i) => (horizontal ? line * w + i : i * w + line);
  for (let line = 0; line < lines; line += 1) {
    for (let i = 0; i < length; i += 1) {
      let sum = 0;
      for (let k = -r; k <= r; k += 1) sum += src[at(line, Math.max(0, Math.min(length - 1, i + k)))];
      out[at(line, i)] = sum / (2 * r + 1);
    }
  }
  return out;
}

function meanDiff(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return a.length ? sum / a.length : 0;
}

// 帧拼图：entries 是 [{ image, label }]，按 perRow 一行排几张，每张左上角标编号。
export function contactSheet(entries, options) {
  const opts = options || {};
  const first = entries[0] && entries[0].image;
  return renderGridSheet(entries, { perRow: opts.perRow || 4, width: opts.width || 1024, fill: Number.isFinite(opts.fill) ? opts.fill : 246, cellAspect: opts.cellAspect || (first ? first.width / first.height : 1) });
}

function range(from, to) {
  const out = [];
  for (let i = from; i <= to; i += 1) out.push(i);
  return out;
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}
