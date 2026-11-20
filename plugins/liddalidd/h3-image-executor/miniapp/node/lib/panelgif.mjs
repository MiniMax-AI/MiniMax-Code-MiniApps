// 组图拼 GIF（面板里）：一张已经画好、评审过的分格组图，由程序切格、按节奏拼成 GIF，不再调生图。
// 两个入口：
//   追问「把这组图变成 GIF」：编辑节点在 animation 里写 from_panels。以前它只能写 start（那是给 GIF 参考图用的），
//   这张图不是 GIF 参考图，系统就当成普通编辑，又照原 prompt 重画了一张静态组图（真机 20261118-db1dd9，多花两次生图、两分多钟）。
//   规划时就要（「画一组六格表情，做成 GIF」）：规划在这张图上写 panel_gif，组图照常生成、评审，交付时拼。
// 之后调快慢、换顺序、去掉某一格只重新拼；改某一格的画面照常改组图，交付时按新的组图重新拼。
// 切格、节奏、编码和读回核对都在 panels.mjs、gifbuild.mjs 里，这里管规格、缓存、交付和落盘。
import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeImage } from './image.mjs';
import { encodePng } from './png.mjs';
import { toRgb } from './gif.mjs';
import { RHYTHM, buildPanelGif, clampMs } from './gifbuild.mjs';
import { loadTweens, prepareGrid, tweenSignature } from './paneltween.mjs';
import { detail, kv, list } from './detail.mjs';

// rev：设定的版本，存在 session.json 里。切格、对齐的做法改了就加 1：拼过的 GIF 按设定缓存（见 composePanelGif），
// 版本一变缓存就失效，下次交付按新的做法重新拼。
// 3：补过渡格，过渡格锁到它画在的那一格上。
export const PANEL_GIF = { minEdge: 240, maxEdge: 1024, rev: 3 };

// 规划写的 panel_gif、落盘的规格 → 规格。字段名两种写法都认（规划写 frame_ms，落盘是 frameMs）。
export function normalizePanelGif(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const grid = (value) => {
    const n = Math.round(Number(value));
    return n >= 1 && n <= 8 ? n : 0;
  };
  const panels = (value) => (Array.isArray(value) ? value.map((item) => Math.round(Number(item))).filter((item) => item >= 1 && item <= 64) : []);
  const count = Math.round(Number(raw.count));
  return {
    rev: PANEL_GIF.rev,
    rows: grid(raw.rows),
    cols: grid(raw.cols),
    count: count >= 2 && count <= 64 ? count : 0,
    order: panels(raw.order).slice(0, 64),
    drop: panels(raw.drop).slice(0, 64),
    frameMs: clampMs(raw.frame_ms ?? raw.frameMs),
    firstMs: clampMs(raw.first_ms ?? raw.firstMs),
    lastMs: clampMs(raw.last_ms ?? raw.lastMs),
    hold: (Array.isArray(raw.hold) ? raw.hold : [])
      .map((item) => ({ index: Math.round(Number(item && item.index)), ms: clampMs(item && item.ms) }))
      .filter((item) => item.index >= 1 && item.ms)
      .slice(0, 64),
    loop: raw.loop !== false,
    pingpong: raw.pingpong === true,
    transition: raw.transition === 'fade' ? 'fade' : 'cut',
    // 切换时弹一下默认不加：整幅画面会跟着放大再落回，对齐得再准，每次切换也会跳一下（见 gifbuild.RHYTHM.pop）。
    bounce: raw.bounce === true,
    edge: clampEdge(raw.edge),
    // 相邻两格之间补过渡格（paneltween.mjs）：默认补，写 false 不补（漫画换场景、用户说直接切换就行）。
    smooth: raw.smooth !== false,
  };
}

// 从 session.json 恢复设定。没有 rev 的是第一版存的：那时切换时弹一下默认开着，不是用户要的，
// 每次切换整幅画面都会跳一下（真机 20261119-250f55），恢复时按现在的默认关掉。那一版还会把编辑节点照抄回来的
// 时长原样写进设定（每格 0.7 秒、第一格 1.05 秒、最后一格 1.4 秒），和默认一样的清回默认，之后调快慢时首尾跟着变。
export function restorePanelGifSpec(raw) {
  const spec = normalizePanelGif(raw);
  if (!spec || Number(raw.rev) >= 2) return spec;
  spec.bounce = false;
  if (spec.frameMs === RHYTHM.frameMs) spec.frameMs = 0;
  const frame = spec.frameMs || RHYTHM.frameMs;
  if (spec.firstMs === Math.round(frame * RHYTHM.firstScale)) spec.firstMs = 0;
  if (spec.lastMs === Math.round(frame * RHYTHM.lastScale)) spec.lastMs = 0;
  return spec;
}

function clampEdge(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return RHYTHM.edge;
  return Math.round(Math.max(PANEL_GIF.minEdge, Math.min(PANEL_GIF.maxEdge, n)));
}

// 把追问里的调整并进规格。返回新规格和改了什么（给事件流看）。格子编号都按从上到下、从左到右数。
// state 是现在这张 GIF 拼出来的样子（image.panelGif），用来认出照抄回来的播放顺序。
// 编辑节点常把上面列出的现有设定原样抄回来（真机 20261119-250f55 说「重新变成gif」，它把每格 0.7 秒、第一格 1.05 秒、
// 切换时弹一下全写了一遍）：和现在一样的项不算改动，也不写进设定。照抄的「第一格 1.05 秒」一旦写死，之后说「慢一点」，
// 第一格就不跟着变慢了。
export function mergePanelOps(current, ops, state) {
  const spec = { ...(normalizePanelGif(current || {}) || normalizePanelGif({})) };
  const changes = [];
  if (!ops) return { spec, changes };
  const frame = spec.frameMs || RHYTHM.frameMs;
  const done = state && state.state === 'done';
  // 现在的播放顺序有两种写法会被抄回来：没来回播时的顺序，和清单里写的实际播放顺序（来回播时是展开的 1…6…2）。
  const base = spec.order.length ? spec.order : done ? (state.panels || []).map((panel) => panel.index).filter((index) => !spec.drop.includes(index)) : [];
  const before = {
    frame,
    first: spec.firstMs || Math.round(frame * RHYTHM.firstScale),
    last: spec.lastMs || Math.round(frame * RHYTHM.lastScale),
    orders: [base.join(','), done ? (state.order || []).join(',') : ''].filter(Boolean),
  };
  if ((ops.rows && ops.rows !== spec.rows) || (ops.cols && ops.cols !== spec.cols)) {
    if (ops.rows) spec.rows = Math.min(8, ops.rows);
    if (ops.cols) spec.cols = Math.min(8, ops.cols);
    changes.push('按 ' + (spec.rows || '?') + ' 行 ' + (spec.cols || '?') + ' 列切格');
  }
  if (ops.count && ops.count !== spec.count) spec.count = ops.count;
  if (ops.frameMs && ops.frameMs !== before.frame) {
    spec.frameMs = ops.frameMs;
    changes.push('每格停 ' + seconds(ops.frameMs));
  }
  if (ops.firstMs && ops.firstMs !== before.first) {
    spec.firstMs = ops.firstMs;
    changes.push('第一格停 ' + seconds(ops.firstMs));
  }
  if (ops.lastMs && ops.lastMs !== before.last) {
    spec.lastMs = ops.lastMs;
    changes.push('最后一格停 ' + seconds(ops.lastMs));
  }
  if (ops.loop !== undefined && ops.loop !== spec.loop) {
    spec.loop = ops.loop;
    changes.push(ops.loop ? '循环播放' : '只播一遍');
  }
  if (ops.pingpong !== undefined && ops.pingpong !== spec.pingpong) {
    spec.pingpong = ops.pingpong;
    changes.push(ops.pingpong ? '来回播' : '不来回播');
  }
  if (ops.transition && (ops.transition === 'fade' ? 'fade' : 'cut') !== spec.transition) {
    spec.transition = ops.transition === 'fade' ? 'fade' : 'cut';
    changes.push(spec.transition === 'fade' ? '两格之间渐变' : '两格之间直接切换');
  }
  if (ops.bounce !== undefined && ops.bounce !== spec.bounce) {
    spec.bounce = ops.bounce;
    changes.push(ops.bounce ? '切换时轻微弹一下' : '切换时不弹');
  }
  if (ops.smooth !== undefined && ops.smooth !== spec.smooth) {
    spec.smooth = ops.smooth;
    changes.push(ops.smooth ? '相邻两格之间补过渡格' : '不补过渡格，两格之间直接切换');
  }
  if (ops.edge && clampEdge(ops.edge) !== spec.edge) {
    spec.edge = clampEdge(ops.edge);
    changes.push('长边 ' + spec.edge + ' 像素');
  }
  for (const hold of ops.hold) {
    if (spec.hold.some((item) => item.index === hold.index && item.ms === hold.ms)) continue;
    spec.hold = spec.hold.filter((item) => item.index !== hold.index).concat([{ index: hold.index, ms: hold.ms }]);
    changes.push('第 ' + hold.index + ' 格停 ' + seconds(hold.ms));
  }
  // order 写的是要留下的全部格子：之前去掉的格子以它为准。
  if (ops.order.length >= 2 && !before.orders.includes(ops.order.join(','))) {
    spec.order = ops.order.slice(0, 64);
    spec.drop = [];
    changes.push('播放顺序改成 ' + spec.order.join('、'));
  }
  const dropped = ops.drop.filter((index) => !spec.drop.includes(index));
  if (dropped.length) {
    spec.drop = spec.drop.concat(dropped);
    if (spec.order.length) spec.order = spec.order.filter((index) => !dropped.includes(index));
    changes.push('去掉第 ' + dropped.join('、') + ' 格');
  }
  return { spec, changes };
}

// 切换时弹一下只在用户自己点名时加：编辑节点、规划会照着现有设定把它抄回来（见 mergePanelOps）。
const BOUNCE_WORDS = /弹|蹦|放大|缩放|bounce|pop/i;

export function bounceAsked(words) {
  return BOUNCE_WORDS.test(String(words || ''));
}

function seconds(ms) {
  return Math.round(ms / 10) / 100 + ' 秒';
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const SAFE = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/;

// 拼 GIF，结果记在 image.panelGif 上，文件写在 images/<候选号>-panels.gif（帧条 -panels-strip.png）。
// 同一张组图、同样的规格拼过就直接用：每次交付都会走到这里，多图任务里没改的图不用重拼。
// hooks：queuePixelWork（像素活排队，见 workflow）、lastDelivered、describeError。
export async function composePanelGif(session, image, deps, hooks) {
  const spec = image.spec && image.spec.panelGif;
  const source = image.chosen || hooks.lastDelivered(session, image, deps);
  if (!spec || !source || !source.path) return null;
  // 过渡格换了（补上了、重画了），GIF 也要重拼。
  const key = source.id + '|' + JSON.stringify(spec) + '|' + (spec.smooth === false ? '' : tweenSignature(image, source.id));
  const prev = image.panelGif;
  if (prev && prev.key === key) {
    if (prev.state === 'failed') return prev;
    if (prev.state === 'done' && (await exists(join(deps.dirs.images, prev.gifFile))) && (await exists(join(deps.dirs.images, prev.stripFile)))) return prev;
  }
  const started = Date.now();
  const stem = (SAFE.test(String(source.id)) ? source.id : image.id) + '-panels';
  try {
    const built = await hooks.queuePixelWork(async () => {
      const rgb = toRgb(decodeImage(await readFile(source.path)));
      const tweens = spec.smooth === false ? new Map() : await loadTweens(image, source, rgb, prepareGrid(rgb, spec), deps);
      return buildPanelGif(rgb, spec, { tweens });
    });
    if (!built.verify.ok) throw new Error('GIF 读回来核对没通过：' + built.verify.problems.join('；'));
    const gifFile = stem + '.gif';
    const stripFile = stem + '-strip.png';
    await writeFile(join(deps.dirs.images, gifFile), built.gif.buffer);
    await writeFile(join(deps.dirs.images, stripFile), encodePng(built.strip, { level: 6 }));
    const { detection, framing, timeline } = built;
    image.panelGif = {
      key,
      state: 'done',
      sourceId: source.id,
      error: '',
      gifFile,
      stripFile,
      width: built.size.width,
      height: built.size.height,
      bytes: built.gif.buffer.length,
      written: built.gif.frameCount,
      durationMs: built.verify.durationMs,
      keyMs: clampMs(spec.frameMs) || RHYTHM.frameMs,
      firstMs: timeline.holds[0],
      lastMs: timeline.holds[timeline.turn],
      loop: timeline.loop,
      pingpong: Boolean(spec.pingpong),
      transition: timeline.transition,
      bounce: timeline.bounce,
      // 用上了几格过渡格、每格停多久
      tweens: timeline.tweens || 0,
      tweenMs: timeline.tweens ? timeline.tweenMs : 0,
      tweenKeys: timeline.steps.filter((step) => step.kind === 'tween').map((step) => step.key).filter((key, i, all) => all.indexOf(key) === i),
      grid: { rows: detection.rows, cols: detection.cols, count: detection.count, method: detection.method },
      panels: detection.cells.map((cell, i) => ({ index: cell.index, row: cell.row, col: cell.col, x: cell.x, y: cell.y, w: cell.w, h: cell.h, dx: framing.frames[i].dx, dy: framing.frames[i].dy })),
      framing: { mode: framing.mode, width: framing.width, height: framing.height, aligned: framing.aligned || 0 },
      order: timeline.order,
      shown: built.shown,
      verify: built.verify,
      at: Date.now(),
    };
    deps.emit(session, 'deliver', image.id + ' 组图拼成 GIF：' + describeState(image.panelGif), {
      durMs: Date.now() - started,
      detail: detail('组图拼 GIF · ' + image.id, [
        kv('切格', describeGrid(image.panelGif)),
        kv('节奏', describeRhythm(image.panelGif)),
        kv('写出', image.panelGif.written + ' 帧，' + image.panelGif.width + '×' + image.panelGif.height + '，' + Math.round(image.panelGif.bytes / 1024) + ' KB，读回核对通过'),
        list(
          '各格',
          image.panelGif.panels.map((panel) => ({
            text: '第 ' + panel.index + ' 格（第 ' + panel.row + ' 行第 ' + panel.col + ' 列）' + (built.shown.includes(panel.index) ? '' : '，没放进 GIF') +
              (panel.dx || panel.dy ? '，对齐挪了 (' + panel.dx + ', ' + panel.dy + ') 像素' : ''),
          })),
        ),
      ]),
    });
  } catch (error) {
    const reason = error && error.message === 'not_grid'
      ? '没在图里找到格子之间的分隔线或留白，切不出两格以上'
      : error && error.message === 'panel_order_too_short'
        ? '按现在的顺序只剩不到 2 格'
        : hooks.describeError(error);
    image.panelGif = { key, state: 'failed', sourceId: source.id, error: reason, notGrid: Boolean(error && error.message === 'not_grid'), at: Date.now() };
    deps.emit(session, 'deliver', image.id + ' 组图没拼成 GIF：' + reason, { level: 'warn', durMs: Date.now() - started });
  }
  return image.panelGif;
}

function describeGrid(state) {
  const how = { line: '按分隔线', gutter: '按留白', free: '按分隔线（格子大小不一）', even: '格子之间没有清楚的分隔，按等分' }[state.grid.method] || '';
  return state.grid.cols + ' 列 ' + state.grid.rows + ' 行共 ' + state.grid.count + ' 格（' + how + '切）' + (state.framing.mode === 'fit' ? '，格子大小不一，缩进同一画幅' : '');
}

function describeRhythm(state) {
  return [
    '播放顺序 ' + state.order.join('、'),
    '每格 ' + seconds(state.keyMs) + '，第一格 ' + seconds(state.firstMs) + '，最后一格 ' + seconds(state.lastMs),
    state.pingpong ? '来回播' : '',
    state.loop ? '循环' : '只播一遍',
    state.tweens ? '补了 ' + (state.tweenKeys || []).length + ' 步过渡格（每格 ' + seconds(state.tweenMs) + '）' : '',
    state.transition === 'fade' ? '两格之间渐变' : state.bounce ? '切换时轻微弹一下' : state.tweens ? '' : '直接切换',
    '共 ' + seconds(state.durationMs),
  ].filter(Boolean).join('，');
}

function describeState(state) {
  return describeGrid(state) + '；' + describeRhythm(state) + '；' + state.written + ' 帧 ' + Math.round(state.bytes / 1024) + ' KB';
}

// 交付卡片上的 gif 一段（和动图的 gif 同一套字段，source 为 panels）。files：这一版交付目录里的 GIF 和帧条。
export function panelGifItem(state, files) {
  return {
    source: 'panels',
    file: files.gif,
    strip: files.strip,
    width: state.width,
    height: state.height,
    bytes: state.bytes,
    // 放进 GIF 的格子数（用户说「第几格」按 items 里的编号）。
    frames: state.shown.length,
    written: state.written,
    frameMs: state.keyMs,
    keyMs: state.keyMs,
    firstMs: state.firstMs,
    lastMs: state.lastMs,
    durationMs: state.durationMs,
    loop: state.loop,
    pingpong: state.pingpong,
    transition: state.transition,
    bounce: state.bounce,
    // 补了几步过渡格（每一步一格）、每格停多久；note 是没补成时的原因
    tweens: (state.tweenKeys || []).length,
    tweenMs: state.tweenMs || 0,
    tweenNote: files.tweenNote || '',
    grid: state.grid,
    order: state.order,
    verify: state.verify,
    items: state.panels.map((panel) => ({ index: panel.index, row: panel.row, col: panel.col, inGif: state.shown.includes(panel.index) })),
  };
}

// 编辑节点 inventory 里这张图的一段说明。
export function panelGifInventory(image) {
  const state = image.panelGif;
  if (!image.spec || !image.spec.panelGif) return '';
  if (!state || state.state !== 'done') return '；这张组图要拼成 GIF，还没拼成' + (state && state.error ? '（' + state.error + '）' : '');
  const smoothNote = image.spec.panelGif.smooth === false
    ? '，说过不补过渡格'
    : state.tweens
      ? ''
      : '，格与格之间还没补过渡格（用户要更顺时写 {"smooth":true}）';
  return '；这是组图拼成的 GIF：' + describeGrid(state) + '，格子编号从上到下、从左到右数；' + describeRhythm(state) + '，长边 ' + image.spec.panelGif.edge + ' 像素' + smoothNote;
}

// 落盘：文件只存文件名，恢复时按会话目录找。
export function snapshotPanelGif(state) {
  if (!state || typeof state !== 'object') return null;
  return JSON.parse(JSON.stringify(state));
}

export function restorePanelGif(raw) {
  if (!raw || typeof raw !== 'object' || !['done', 'failed'].includes(raw.state)) return null;
  if (raw.state === 'done' && !(SAFE.test(String(raw.gifFile || '')) && SAFE.test(String(raw.stripFile || '')))) return null;
  const out = JSON.parse(JSON.stringify(raw));
  out.key = String(raw.key || '');
  out.error = String(raw.error || '');
  if (out.state === 'done') {
    for (const field of ['width', 'height', 'bytes', 'written', 'durationMs', 'keyMs', 'firstMs', 'lastMs']) out[field] = Number(raw[field]) || 0;
    out.order = Array.isArray(raw.order) ? raw.order.map(Number).filter((n) => n >= 1) : [];
    out.shown = Array.isArray(raw.shown) ? raw.shown.map(Number).filter((n) => n >= 1) : [];
    out.panels = Array.isArray(raw.panels) ? raw.panels : [];
    if (!out.grid || typeof out.grid !== 'object') out.grid = { rows: 0, cols: 0, count: out.panels.length, method: '' };
    if (!out.framing || typeof out.framing !== 'object') out.framing = { mode: 'crop', width: 0, height: 0, aligned: 0 };
  }
  return out;
}
