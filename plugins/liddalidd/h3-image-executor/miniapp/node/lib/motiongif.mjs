// 程序转圈的 GIF（面板里）：一张画好、评审过的图，由程序绕圆心转出各帧拼成 GIF，不再一帧一帧调生图。
// 加载圈、转动的图标、齿轮、风车这类「绕一个中心转」的动作，生图模型一帧一帧改画不准：真机 20261119-e645c0 的
// 十二点加载圈，十二帧有一半亮点落错格子，扔掉之后亮点一下跳一格、一下跳三格。转法见 motion.mjs、gifbuild.buildSpinGif。
// 两个入口：规划时就要（规划在这张图上写 motion_gif），图照常生成、评审，交付时转；追问「让它转起来」（编辑节点写
// animation.motion）。之后调快慢、换方向只重新转；改画面照常改图，交付时按新图重新转。
import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeImage } from './image.mjs';
import { encodePng } from './png.mjs';
import { buildSpinGif, clampSpinMs } from './gifbuild.mjs';
import { normalizeSpin } from './motion.mjs';
import { detail, kv } from './detail.mjs';

// rev：设定的版本，转法改了就加 1，拼过的 GIF 缓存跟着失效（见 composeMotionGif）。
export const MOTION_GIF = { rev: 1, minEdge: 240, maxEdge: 1024, edge: 512 };

export const MOTION_TYPES = ['spin'];

// 规划写的 motion_gif、编辑节点写的 animation.motion、落盘的设定 → 规格。不是认得的动法返回 null。
export function normalizeMotionGif(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = String(raw.type || 'spin').trim().toLowerCase();
  if (!MOTION_TYPES.includes(type)) return null;
  const transition = raw.transition === 'fade' ? 'fade' : raw.transition === 'cut' ? 'cut' : '';
  return {
    rev: MOTION_GIF.rev,
    type,
    spin: normalizeSpin(raw.spin && typeof raw.spin === 'object' ? raw.spin : raw),
    frameMs: clampSpinMs(raw.frame_ms ?? raw.frameMs),
    loop: raw.loop !== false,
    transition,
    edge: clampEdge(raw.edge),
  };
}

function clampEdge(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return MOTION_GIF.edge;
  return Math.round(Math.max(MOTION_GIF.minEdge, Math.min(MOTION_GIF.maxEdge, n)));
}

// 追问里的调整并进规格。ops 是 normalizeAnimationOps 的结果：frameMs、loop、edge、transition 在外层，
// 转法本身（方向、格数、圆心、半径）在 ops.motion 里，只写了的才改。和现在一样的不算改动。
export function mergeMotionOps(current, ops) {
  const spec = current ? { ...normalizeMotionGif({ ...current, spin: current.spin }) } : normalizeMotionGif(ops && ops.motion ? ops.motion : {});
  const changes = [];
  if (!spec || !ops) return { spec, changes };
  const motion = ops.motion && typeof ops.motion === 'object' ? ops.motion : {};
  const spin = { ...spec.spin };
  if (current) {
    if ((motion.direction === 'cw' || motion.direction === 'ccw') && motion.direction !== spin.direction) {
      spin.direction = motion.direction;
      changes.push(motion.direction === 'ccw' ? '改成逆时针转' : '改成顺时针转');
    }
    if (motion.steps !== undefined) {
      const next = normalizeSpin({ ...spin, steps: motion.steps, frames: motion.frames ?? spin.frames });
      if (next.steps !== spin.steps) {
        spin.steps = next.steps;
        spin.frames = next.frames;
        changes.push(next.steps ? '一圈 ' + next.steps + ' 格，一格一格跳' : '连续转');
      }
    }
    if (motion.frames !== undefined && !spin.steps) {
      const next = normalizeSpin({ ...spin, frames: motion.frames });
      if (next.frames !== spin.frames) {
        spin.frames = next.frames;
        changes.push('一圈 ' + next.frames + ' 帧');
      }
    }
    if (Array.isArray(motion.center) || motion.radius !== undefined) {
      const next = normalizeSpin({ ...spin, center: motion.center || spin.center, radius: motion.radius ?? spin.radius });
      if (next.center.join(',') !== spin.center.join(',') || next.radius !== spin.radius) {
        spin.center = next.center;
        spin.radius = next.radius;
        changes.push('圆心和转的范围按新的位置');
      }
    }
  }
  spec.spin = spin;
  // 外层的 frame_ms 经过 normalizeAnimationOps，最短只到 60 毫秒；转圈要更短的就写在 motion 里。
  const frameMs = clampSpinMs(motion.frame_ms ?? motion.frameMs) || ops.frameMs;
  if (frameMs && frameMs !== spec.frameMs) {
    spec.frameMs = frameMs;
    changes.push('每格停 ' + seconds(frameMs));
  }
  if (ops.loop !== undefined && ops.loop !== spec.loop) {
    spec.loop = ops.loop;
    changes.push(ops.loop ? '循环播放' : '只转一圈');
  }
  const transition = ops.transition || (motion.transition === 'fade' || motion.transition === 'cut' ? motion.transition : '');
  if (transition && transition !== effectiveTransition(spec)) {
    spec.transition = transition;
    changes.push(transition === 'fade' ? '两格之间渐变' : '直接切换');
  }
  const edge = ops.edge || (motion.edge ? clampEdge(motion.edge) : 0);
  if (edge && edge !== spec.edge) {
    spec.edge = edge;
    changes.push('长边 ' + edge + ' 像素');
  }
  return { spec, changes };
}

function effectiveTransition(spec) {
  return spec.transition || (spec.spin.steps ? 'fade' : 'cut');
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

// 转出 GIF，结果记在 image.motionGif 上，文件写在 images/<候选号>-spin.gif（帧条 -spin-strip.png）。
// 同一张图、同样的设定转过就直接用。hooks：queuePixelWork、lastDelivered、describeError。
export async function composeMotionGif(session, image, deps, hooks) {
  const spec = image.spec && image.spec.motionGif;
  const source = image.chosen || hooks.lastDelivered(session, image, deps);
  if (!spec || !source || !source.path) return null;
  const key = source.id + '|' + JSON.stringify(spec);
  const prev = image.motionGif;
  if (prev && prev.key === key) {
    if (prev.state === 'failed') return prev;
    if (prev.state === 'done' && (await exists(join(deps.dirs.images, prev.gifFile))) && (await exists(join(deps.dirs.images, prev.stripFile)))) return prev;
  }
  const started = Date.now();
  const stem = (SAFE.test(String(source.id)) ? source.id : image.id) + '-spin';
  try {
    const built = await hooks.queuePixelWork(async () => {
      const decoded = decodeImage(await readFile(source.path));
      return { decoded: { width: decoded.width, height: decoded.height }, ...buildSpinGif(decoded, spec) };
    });
    if (!built.verify.ok) throw new Error('GIF 读回来核对没通过：' + built.verify.problems.join('；'));
    const gifFile = stem + '.gif';
    const stripFile = stem + '-strip.png';
    await writeFile(join(deps.dirs.images, gifFile), built.gif.buffer);
    await writeFile(join(deps.dirs.images, stripFile), encodePng(built.strip, { level: 6 }));
    const { width, height } = built.decoded;
    const short = Math.min(width, height);
    image.motionGif = {
      key,
      state: 'done',
      sourceId: source.id,
      error: '',
      type: spec.type,
      gifFile,
      stripFile,
      width: built.size.width,
      height: built.size.height,
      bytes: built.gif.buffer.length,
      written: built.gif.frameCount,
      frames: built.count,
      durationMs: built.verify.durationMs,
      keyMs: built.frameMs,
      steps: built.spin.steps,
      direction: built.spin.direction,
      transition: built.fade ? 'fade' : 'cut',
      loop: built.loop,
      // 程序最后用的圆心（画面比例）、转的半径（短边比例），和规划给的圆心差多少（短边比例）
      center: [round3(built.where.cx / width), round3(built.where.cy / height)],
      radius: round3(built.where.radius / short),
      moved: round3(built.where.refined.moved / short),
      verify: built.verify,
      at: Date.now(),
    };
    deps.emit(session, 'deliver', image.id + ' 程序转出 GIF：' + describeState(image.motionGif), {
      durMs: Date.now() - started,
      detail: detail('程序转圈 · ' + image.id, [
        kv('转法', describeSpin(image.motionGif)),
        kv('圆心', '(' + image.motionGif.center.join(', ') + ')，转的范围半径 ' + image.motionGif.radius + '（画面短边的比例）' +
          (image.motionGif.moved ? '，比规划给的圆心挪了 ' + image.motionGif.moved : '')),
        kv('写出', image.motionGif.written + ' 帧，' + image.motionGif.width + '×' + image.motionGif.height + '，' + Math.round(image.motionGif.bytes / 1024) + ' KB，读回核对通过'),
      ]),
    });
  } catch (error) {
    const reason = hooks.describeError(error);
    image.motionGif = { key, state: 'failed', sourceId: source.id, error: reason, at: Date.now() };
    deps.emit(session, 'deliver', image.id + ' 没转成 GIF：' + reason, { level: 'warn', durMs: Date.now() - started });
  }
  return image.motionGif;
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function describeSpin(state) {
  return [
    state.direction === 'ccw' ? '逆时针' : '顺时针',
    state.steps ? '一圈 ' + state.steps + ' 格、一格一格跳，每格 ' + seconds(state.keyMs) : '连续转，一圈 ' + state.frames + ' 帧、每帧 ' + seconds(state.keyMs),
    state.transition === 'fade' ? '两格之间渐变' : '直接切换',
    state.loop ? '循环' : '只转一圈',
    '一圈 ' + seconds(state.durationMs),
  ].join('，');
}

function describeState(state) {
  return describeSpin(state) + '；' + state.written + ' 帧 ' + Math.round(state.bytes / 1024) + ' KB';
}

// 交付卡片上的 gif 一段（source 为 motion）。
export function motionGifItem(state, files) {
  return {
    source: 'motion',
    type: state.type,
    file: files.gif,
    strip: files.strip,
    width: state.width,
    height: state.height,
    bytes: state.bytes,
    frames: state.frames,
    written: state.written,
    frameMs: state.keyMs,
    keyMs: state.keyMs,
    durationMs: state.durationMs,
    loop: state.loop,
    transition: state.transition,
    steps: state.steps,
    direction: state.direction,
    center: state.center,
    radius: state.radius,
    verify: state.verify,
  };
}

// 编辑节点 inventory 里这张图的一段说明。
export function motionGifInventory(image) {
  const state = image.motionGif;
  if (!image.spec || !image.spec.motionGif) return '';
  if (!state || state.state !== 'done') return '；这张图要由程序转成 GIF，还没转成' + (state && state.error ? '（' + state.error + '）' : '');
  return '；这是程序绕圆心转出来的 GIF：' + describeSpin(state) + '，圆心 (' + state.center.join(', ') + ')，长边 ' + image.spec.motionGif.edge + ' 像素';
}

export function snapshotMotionGif(state) {
  if (!state || typeof state !== 'object') return null;
  return JSON.parse(JSON.stringify(state));
}

export function restoreMotionGif(raw) {
  if (!raw || typeof raw !== 'object' || !['done', 'failed'].includes(raw.state)) return null;
  if (raw.state === 'done' && !(SAFE.test(String(raw.gifFile || '')) && SAFE.test(String(raw.stripFile || '')))) return null;
  const out = JSON.parse(JSON.stringify(raw));
  out.key = String(raw.key || '');
  out.error = String(raw.error || '');
  if (out.state === 'done') {
    for (const field of ['width', 'height', 'bytes', 'written', 'frames', 'durationMs', 'keyMs', 'steps', 'radius', 'moved']) out[field] = Number(raw[field]) || 0;
    out.center = Array.isArray(raw.center) && raw.center.length === 2 ? raw.center.map(Number) : [0.5, 0.5];
  }
  return out;
}
