// GIF 动图：一张参考图 → 若干帧 → 程序合成的 GIF。
//
// 参考图从哪来：用户给了图，规划写它的 R 编号，各帧直接照这张图改；用户没给，这张图先按正常流程画出来、交付，
// 等用户确认（或者先改一改）再出帧。帧全都照着参考图改，参考图不对，后面每一帧都白画。
// 第一帧从参考图改，后面每一帧在前一帧上接着改一小步，参考图作为第 2 张图一起送进去，锁住身份、服装、背景和颜色
// （见 framePrompt）。以前每一帧单独从参考图改，同一句「双手抬到胸口」每次画得都不一样，相邻两帧的手一会儿高一会儿低。
// 每一帧的 prompt 照样写这一帧的完整状态：前面帧里做出的变化（伞斜过来了），后面的帧要保持就再写一遍。
// 模型每次改图都会把整幅细纹理重画、画面轻微错位，合成时 gif.mjs 把每一帧锁回参考图，背景才不闪。
// 一步跨得太大的地方补过渡帧，没过评审的帧不放进 GIF，每一帧停一样久（见 smoothSteps、playable、playOrder）。
// 评审一次看全部帧：逐帧评审每次要几分钟，12 帧就是十几次；放在一起看还能判断整组连起来顺不顺。
// 只重画判了不合格的帧，最多一次。帧画完由 gif.mjs 合成，再从写出去的文件读回来核对帧数、尺寸和时长。

import { readFile, writeFile, copyFile, access } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import * as h3 from './h3.mjs';
import { decodeImage, extensionFor, sniffFormat } from './image.mjs';
import { downsample, encodePng } from './png.mjs';
import { buildGridSheet } from './review.mjs';
import { decodeGif, fitFrame, gifSize, makeGif, motionSteps } from './gif.mjs';
import { detail, kv, list, text } from './detail.mjs';
import { difficultyOf, hitsOf, noteToolHit, toolBudget } from './budget.mjs';

export const ANIMATION = {
  // 帧数按动作幅度定：大动作要拆成十几小步才顺，以前的 12 帧上限不够再补过渡帧（见 smoothSteps）。
  maxFrames: 16,
  frameMs: 300,
  minFrameMs: 60,
  maxFrameMs: 3000,
  edge: 768,
  minEdge: 240,
  maxEdge: 1024,
  // GIF 最大 1024 像素，帧用 2K 出图就够，比 4K 快。
  frameArea: '2K',
  // 评审判不合格的帧最多重画几次。
  frameRedo: 1,
  previewEdge: 512,
  reviewWidth: 1536,
  // transition 为 fade 时，相邻关键帧之间补几帧渐变。
  tween: 2,
  // 渐变只补在变化不超过这么多（占整幅）的两帧之间：差得多的两帧叠在一起是两个半透明的人影。
  // 比补中间帧的门槛（SMOOTH.stepLimit）略高：补过中间帧、变化压到门槛以下的每一步都照常补渐变。
  tweenMaxChange: 0.1,
};

export const TRANSITIONS = ['fade', 'cut'];

// 待确认的参考图卡片上那个按钮发的话。原样收到这句就直接开始出帧，不经过编辑节点。
export const ANIMATE_CONFIRM = '用这张参考图生成 GIF';

export function confirmText(imageId) {
  return ANIMATE_CONFIRM + '（' + imageId + '）';
}

export function confirmTarget(instruction) {
  const match = /^用这张参考图生成 GIF（([A-Za-z0-9]{1,8})）$/.exec(String(instruction || '').trim());
  return match ? match[1].toUpperCase() : '';
}

// 规划写的 animation → 规格。frames 少于 2 帧、或者全是「参考图本身」，就不是动图。
export function normalizeAnimation(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const frames = (Array.isArray(raw.frames) ? raw.frames : []).slice(0, ANIMATION.maxFrames).map(normalizeFrame);
  if (frames.length < 2 || frames.every((frame) => frame.same)) return null;
  const reference = typeof raw.reference === 'string' && /^R\d+$/i.test(raw.reference.trim()) ? raw.reference.trim().toUpperCase() : 'self';
  return {
    reference,
    frames,
    frameMs: clampMs(raw.frame_ms ?? raw.frameMs) || ANIMATION.frameMs,
    loop: raw.loop !== false,
    edge: clampEdge(raw.edge),
    transition: normalizeTransition(raw.transition) || 'fade',
  };
}

function normalizeTransition(value) {
  const text = String(value || '').trim().toLowerCase();
  return TRANSITIONS.includes(text) ? text : '';
}

// 恢复出来的旧会话没有 transition，按默认的渐变处理。
export function transitionOf(spec) {
  return normalizeTransition(spec && spec.transition) || 'fade';
}

function normalizeFrame(item) {
  const value = typeof item === 'string' ? { prompt: item } : item && typeof item === 'object' ? item : {};
  const prompt = String(value.prompt || '').trim().slice(0, 600);
  return { prompt, same: value.same === true || !prompt, holdMs: clampMs(value.hold_ms ?? value.holdMs) };
}

function clampMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(Math.max(ANIMATION.minFrameMs, Math.min(ANIMATION.maxFrameMs, n)));
}

function clampEdge(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return ANIMATION.edge;
  return Math.round(Math.max(ANIMATION.minEdge, Math.min(ANIMATION.maxEdge, n)));
}

export function isAnimation(image) {
  return Boolean(image && image.spec && image.spec.animation);
}

// 规划直接用用户给的图当参考图（不用先画）。R 编号在会话里找不到的，退回先画一张。
export function usesGivenReference(session, image) {
  const spec = image.spec && image.spec.animation;
  return Boolean(spec && spec.reference !== 'self' && (session.refs || []).some((ref) => ref.id === spec.reference));
}

// 运行状态：state 是 awaiting_confirm（参考图交付了，等用户确认）/ frames（出帧中）/ done / failed。
// 每帧有一个不复用的 uid，候选文件名用它（A F<uid>-r<n>-g0），删帧、加帧、调顺序都不会让文件互相覆盖。
export function ensureState(image) {
  if (!image.animation) image.animation = { state: '', refId: '', refFile: '', width: 0, height: 0, nextUid: 1, frames: [], reviews: [], error: '' };
  const anim = image.animation;
  if (!anim.frames.length) anim.frames = image.spec.animation.frames.map((frame) => newFrame(anim, frame));
  return anim;
}

function newFrame(anim, frame) {
  const uid = anim.nextUid;
  anim.nextUid += 1;
  return {
    uid,
    prompt: frame.prompt,
    same: Boolean(frame.same),
    holdMs: frame.holdMs || 0,
    status: frame.same ? 'passed' : 'pending',
    problem: '',
    retryPrompt: '',
    note: '',
    own: Boolean(frame.own),
    rounds: 0,
    // inbetween：程序补的过渡帧；between：它夹在哪两帧中间（两帧的 uid，画的时候把这两帧的图都送进去）。
    inbetween: Boolean(frame.inbetween),
    between: Array.isArray(frame.between) ? frame.between.slice(0, 2) : null,
    candidates: [],
  };
}

// 参考图交付之后改它（换颜色、换衣服）：旧的帧作废，等用户确认新的参考图再重新出帧。
// 帧的安排（追问里加过、删过的帧）保留，uid 接着往上编，旧帧的文件不会被覆盖。
export function resetForNewReference(image) {
  const old = image.animation && image.animation.frames.length ? image.animation.frames : image.spec.animation.frames;
  const nextUid = image.animation ? image.animation.nextUid : 1;
  image.spec.animation.reference = 'self';
  image.animation = { state: 'awaiting_confirm', refId: '', refFile: '', width: 0, height: 0, nextUid, frames: [], reviews: [], error: '' };
  image.animation.frames = old.map((frame) => newFrame(image.animation, frame));
  return image.animation;
}

export function latestCandidate(frame) {
  return frame && frame.candidates.length ? frame.candidates[frame.candidates.length - 1] : null;
}

// 来回往复的动作（手在脸旁 → 举过头顶 → 回到脸旁）里，同一个姿态会出现好几次。各画各的，同一个姿态每次都略有
// 不同，播到这里画面会抖；所以 prompt 一模一样的帧只画一次，后面的直接用最早那一帧的图。
// 追问里单独重画其中一帧（不给新说法）时打上 own，它就自己画。
export function mirrorSource(anim, frame) {
  if (!frame || frame.same || frame.own) return null;
  const key = promptKey(frame.prompt);
  for (const other of anim.frames) {
    if (other === frame) return null;
    if (!other.same && promptKey(other.prompt) === key) return other;
  }
  return null;
}

function promptKey(value) {
  return String(value || '').replace(/[\s。；;，,、！!]+/g, '');
}

// 这一帧实际用哪张图：参考图本身返回 null，同姿态的帧用最早那一帧的候选。
export function frameCandidate(anim, frame) {
  if (frame.same) return null;
  return latestCandidate(mirrorSource(anim, frame) || frame);
}

const RATIOS = ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16'];

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

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function nextRefId(session) {
  let max = 0;
  for (const ref of session.refs || []) {
    const match = /^R(\d+)$/.exec(String(ref.id || ''));
    if (match) max = Math.max(max, Number(match[1]));
  }
  return 'R' + (max + 1);
}

// 参考图：已经定过的接着用；规划点名的 R 编号；否则拿这张图当前交付的那一版，登记成新的 R 编号
// （之后评审、编辑都认它），文件拷进 refs/。上传一次，各帧共用同一个 mm_file://。
async function prepareContext(session, image, deps, hooks) {
  const anim = image.animation;
  const spec = image.spec.animation;
  let ref = anim.refId ? (session.refs || []).find((item) => item.id === anim.refId) : null;
  if (ref && !(await exists(ref.path))) ref = null;
  if (!ref && spec.reference !== 'self') ref = (session.refs || []).find((item) => item.id === spec.reference) || null;
  if (!ref) {
    const source = image.chosen || hooks.lastDelivered(session, image, deps);
    if (!source || !source.path) throw new Error('这张 GIF 还没有参考图');
    const buffer = await readFile(source.path);
    const id = nextRefId(session);
    const file = id + extensionFor(buffer);
    const path = join(deps.dirs.refs, file);
    await writeFile(path, buffer);
    ref = { id, file, path, note: 'GIF 参考图（' + image.id + '）', origin: 'generated' };
    session.refs.push(ref);
    // 评审用的参考图拼图是缓存的，新登记了参考图就要重拼。
    session.refSheet = null;
  }
  const buffer = await readFile(ref.path);
  const format = sniffFormat(buffer);
  if (format !== 'png' && format !== 'jpeg') throw new Error('参考图是 ' + format + ' 格式，程序解不开，GIF 需要 PNG 或 JPEG 的参考图');
  const decoded = decodeImage(buffer);
  anim.refId = ref.id;
  anim.refFile = ref.file;
  anim.width = decoded.width;
  anim.height = decoded.height;
  const preview = downsample(decoded, ANIMATION.previewEdge);
  const previewPath = join(deps.dirs.previews, ref.id + '-gif.png');
  await writeFile(previewPath, encodePng(preview));
  const mm = await h3.resolveReference(deps.config, ref.path);
  return { ref, mm, aspect: aspectFor(decoded.width, decoded.height), width: decoded.width, height: decoded.height, preview, previewPath, stopped: '' };
}

// 每一帧怎么画（mode）：
//   ref：从参考图改（第 1 帧，或者前面一帧都没画成时）；
//   chain：在上一帧上接着改、只动一小步，参考图作为第 2 张图锁住身份、服装、背景和颜色；
//   between：补的过渡帧，第 1 张是前一帧、第 3 张是后一帧，画两者正中间的状态。
// 以前每一帧都单独从参考图改：模型对「双手抬到胸口」这类说法每次理解得都不一样，相邻两帧的手一会儿高一会儿低，
// 锁回参考图之后相邻两帧还差 10–20%（真机 20261117-cd2dc5）。接着上一帧改，两帧之间只差这一小步。
// 一帧比一帧偏的老问题由参考图（第 2 张）、合成时锁回参考图的背景和色调兜住。
export function framePrompt(frame, position, total, mode) {
  const change = String(frame.retryPrompt || frame.prompt).replace(/[。；;，,\s]+$/, '');
  const problem = frame.problem ? '（上一版这一帧的问题：' + frame.problem + '。这一次必须改正。）' : '';
  const keep =
    '主体的身份和五官、服装、画风、背景、光线和颜色都以参考图为准；构图、主体在画面里的位置和大小不变，' +
    '不要移动镜头、不要缩放、不要裁切；参考图里有的文字和符号一个都不要少，也不要添加新的物体、文字或水印。';
  if (mode === 'chain') {
    return (
      '这是一组 GIF 动图里的第 ' + position + ' 帧（共 ' + total + ' 帧）。第 1 张图是上一帧，在它上面接着改，只动一小步，改到这个样子：' +
      change + '。第 2 张图是这组动图的参考图：' + keep + problem
    );
  }
  if (mode === 'between') {
    return (
      '这是一组 GIF 动图里补的过渡帧（第 ' + position + ' 帧，共 ' + total + ' 帧）。第 1 张图是前一帧，第 3 张图是后一帧，' +
      '以第 1 张为底图来改，画两者正中间的状态：每个在动的部位（头的角度和朝向、手和手臂的位置、肩膀、眉毛、眼睛、嘴型）都走到一半，' +
      '不要画成第 1 张或第 3 张的样子。第 2 张图是这组动图的参考图：' + keep + '（两帧的说明：' + change + '）' + problem
    );
  }
  return (
    '这是一组 GIF 动图里的第 ' + position + ' 帧（共 ' + total + ' 帧），在输入的这张参考图上改。只做这些改动：' +
    change +
    '。除此之外的一切——主体的外形、配色和身份，画风，背景，光线，构图，主体在画面里的位置和大小——都和参考图保持完全一致；' +
    '不要移动镜头、不要缩放、不要裁切，不要添加文字、水印或新的物体。' +
    problem
  );
}

// 出帧 + 评审 + 重画判了不合格的帧。只处理还没画好的帧（pending / failed），已经通过的帧不动。
export async function runFrames(session, image, deps, hooks) {
  const anim = ensureState(image);
  anim.state = 'frames';
  anim.error = '';
  // 先画出来的参考图本身是好的：帧没做成时，这张图照样按它自己的结论交付。
  const before = image.status;
  image.status = 'running';
  const started = Date.now();
  let ctx;
  try {
    ctx = await prepareContext(session, image, deps, hooks);
  } catch (error) {
    image.status = image.chosen ? before : 'failed';
    throw error;
  }
  const todo = anim.frames.filter((frame) => !frame.same && !mirrorSource(anim, frame) && (frame.status === 'pending' || frame.status === 'failed'));
  const mirrored = anim.frames.filter((frame) => mirrorSource(anim, frame)).length;
  deps.emit(session, 'paint', image.id + ' 开始出 GIF 的 ' + todo.length + ' 帧：每一帧都从参考图 ' + ctx.ref.id + ' 改出来' + (mirrored ? '（' + mirrored + ' 帧和前面的姿态相同，直接复用）' : ''), {
    detail: detail('GIF · ' + image.id, [
      kv('参考图', ctx.ref.id + '（' + ctx.width + '×' + ctx.height + '）'),
      kv('帧数', anim.frames.length + ' 帧，要画 ' + todo.length + ' 帧，每帧 ' + image.spec.animation.frameMs + ' 毫秒' + (image.spec.animation.loop ? '，循环' : '，只播一遍')),
      list('每一帧', anim.frames.map((frame, index) => ({ text: '第 ' + (index + 1) + ' 帧：' + describeFrame(anim, frame) }))),
    ]),
  });
  await generateFrames(session, image, ctx, deps, hooks, todo);
  await reviewFrames(session, image, ctx, deps, hooks, todo);
  await redoRejected(session, image, ctx, deps, hooks, todo);
  // 重画过还没过评审的帧不放进 GIF（见 playable）：先定下来，再量相邻两帧、补过渡帧，过渡帧才补在真正播放的两帧之间。
  // 以前这一步放在补过渡帧后面：过渡帧照着之后被扔掉的帧画（真机 20261118-d490f3 第 9 帧夹在被扔掉的第 8 帧和第 10 帧中间），
  // 扔掉的帧留下的空当反而没人补（真机 20261119-e645c0 十二帧扔了六帧，亮点一下跳一格、一下跳三格）。
  for (const frame of todo) if (frame.status === 'rejected') frame.status = 'unpassed';
  // 一步跨得太大的地方（包括扔掉帧留下的空当）补中间帧（补的帧照样评审、不合格的重画一次，还不合格就不用）。
  if (!ctx.stopped && !hooks.isCancelled(session)) await smoothSteps(session, image, ctx, deps, hooks);
  for (const frame of todo) {
    if (frame.status === 'rejected') frame.status = 'unpassed';
    if (frame.status === 'running' || frame.status === 'pending') frame.status = latestCandidate(frame) ? 'unreviewed' : 'failed';
  }
  syncMirrors(anim);
  const usable = anim.frames.filter((frame) => frame.same || frameCandidate(anim, frame));
  anim.state = usable.length >= 2 ? 'done' : 'failed';
  if (anim.state === 'failed') anim.error = ctx.stopped || '能用的帧不到 2 帧';
  const clean = anim.frames.every((frame) => frame.same || frame.status === 'passed');
  image.status = anim.state === 'done' ? (clean ? 'passed' : 'unpassed') : image.chosen ? before : 'failed';
  deps.emit(session, 'paint', image.id + ' GIF 的帧画完了：' + summarizeFrames(anim), { durMs: Date.now() - started, level: clean ? 'info' : 'warn' });
}

async function redoRejected(session, image, ctx, deps, hooks, todo) {
  const anim = image.animation;
  for (let attempt = 0; attempt < ANIMATION.frameRedo && !ctx.stopped && !hooks.isCancelled(session); attempt += 1) {
    const redo = todo.filter((frame) => frame.status === 'rejected' || frame.status === 'failed');
    if (!redo.length) break;
    deps.emit(session, 'refine', image.id + ' 重画 ' + redo.length + ' 帧：' + redo.map((frame) => '第 ' + (anim.frames.indexOf(frame) + 1) + ' 帧').join('、'));
    await generateFrames(session, image, ctx, deps, hooks, redo);
    await reviewFrames(session, image, ctx, deps, hooks, redo);
  }
}

// ------------------------------------------------------------------ 补中间帧
//
// 帧画完之后量一遍相邻两帧变了多少（锁回参考图之后，和合成时一样），一步跨得太大的地方补一帧过渡：
// 第 1 张送前一帧、第 3 张送后一帧，让模型以前一帧为底画两者正中间的状态，评审照常核对，没过评审的不用。
// 只靠文字说「走到三分之一」、从参考图重画，模型画不准：真机 20261117-cd2dc5 补的 4 帧，补完相邻两帧还差 13–20%。
// 来回往复的动作里 A→B 和 B→A 补的是同一帧，只画一次。时长在合成时统一分配（见 playOrder），补帧不会让节奏忽快忽慢。
const SMOOTH = { stepLimit: 0.09, maxNew: 6 };

async function smoothSteps(session, image, ctx, deps, hooks) {
  const anim = image.animation;
  const spec = image.spec.animation;
  const usable = playable(anim);
  if (usable.length < 2) return;
  const decoded = new Map();
  const images = [];
  try {
    for (const frame of usable) {
      if (frame.same) {
        images.push(ctx.preview);
        continue;
      }
      const candidate = frameCandidate(anim, frame);
      const path = candidate.preview || candidate.path;
      if (!decoded.has(path)) decoded.set(path, decodeImage(await readFile(path)));
      images.push(decoded.get(path));
    }
  } catch {
    return;
  }
  const steps = motionSteps(images, ctx.preview, { loop: spec.loop, edge: 384 });
  // 只播一遍的：最后一帧到第一帧不算一步（motionSteps 已经不算）；循环播放的也算上接缝那一步。
  const keyOf = (frame) => (frame.same ? '0' : 'c' + frameCandidate(anim, frame).id);
  const plans = [];
  const prompts = new Set();
  // 按真正播放的帧数封顶：扔掉的帧不播，不占名额。
  let total = usable.length;
  // 扔掉了帧的空当先补，而且不管量出来变了多少都补：那一帧是规划里本来就要有的一步。真机试过：柴犬抬爪扔掉「举到头顶」那一帧，
  // 爪子从脸旁直接跳到头顶上方挥手，只变了画面的一小块，量出来不到补帧的门槛，结果就没补。
  const dropped = (step) => droppedBetween(anim, usable[step.from], usable[step.to]).length;
  const ranked = steps.slice().sort((x, y) => (dropped(y) > 0) - (dropped(x) > 0) || y.change - x.change);
  for (const step of ranked) {
    if ((step.change <= SMOOTH.stepLimit && !dropped(step)) || total >= ANIMATION.maxFrames) continue;
    const a = usable[step.from];
    const b = usable[step.to];
    // 方向统一成两帧的先后：A→B 和 B→A 写出来是同一句话、同一对底图，第二次直接复用。
    const [first, second] = keyOf(a) <= keyOf(b) ? [a, b] : [b, a];
    // 两帧中间正好扔了一帧：过渡帧就是替它补上，把它原来的计划写进去，模型知道中间该是什么样。
    const gap = droppedBetween(anim, a, b);
    const prompt = '姿态 A（第 1 张）：' + describePose(first) + '；姿态 B（第 3 张）：' + describePose(second) +
      (gap.length === 1 && gap[0].prompt ? '；这一帧原来的计划：' + describePose(gap[0]) : '');
    if (!prompts.has(prompt) && prompts.size >= SMOOTH.maxNew) continue;
    prompts.add(prompt);
    plans.push({ a, b, step, prompt, between: [first.uid, second.uid] });
    total += 1;
  }
  if (!plans.length) return;
  const added = [];
  for (const plan of plans) {
    const frame = newFrame(anim, { prompt: plan.prompt, same: false, holdMs: 0, inbetween: true });
    frame.between = plan.between;
    anim.frames.splice(anim.frames.indexOf(plan.a) + 1, 0, frame);
    added.push(frame);
  }
  if (plans.some((plan) => droppedBetween(anim, plan.a, plan.b).length)) {
    deps.emit(session, 'paint', image.id + ' 没过评审、扔掉的帧留下的空当，也按前后两帧补过渡帧');
  }
  const todo = added.filter((frame) => !mirrorSource(anim, frame));
  deps.emit(session, 'paint', image.id + ' 有 ' + plans.length + ' 步动作跨得太大，每步补 1 帧过渡（要画 ' + todo.length + ' 帧）', {
    detail: detail('补过渡帧 · ' + image.id, [
      list('相邻两帧变了多少（锁回参考图之后，占整幅）', steps.map((step) => ({
        tag: step.change > SMOOTH.stepLimit ? 'warn' : 'pass',
        text: '第 ' + (anim.frames.indexOf(usable[step.from]) + 1) + ' → ' + (step.to < step.from ? '第 1' : '下一') + ' 帧：' + Math.round(step.change * 100) + '%',
      }))),
    ]),
  });
  await generateFrames(session, image, ctx, deps, hooks, todo);
  await reviewFrames(session, image, ctx, deps, hooks, todo);
  await redoRejected(session, image, ctx, deps, hooks, todo);
  syncMirrors(anim);
  // 补的帧是锦上添花：没画出来、没过评审的不用。
  const bad = added.filter((frame) => frame.status !== 'passed');
  if (bad.length) {
    anim.frames = anim.frames.filter((frame) => !bad.includes(frame));
    deps.emit(session, 'paint', image.id + ' 补的过渡帧有 ' + bad.length + ' 帧没过评审，不用', { level: 'warn' });
  }
}

function describePose(frame) {
  return frame.same ? '和参考图一模一样' : String(frame.prompt).replace(/[。；;，,\s]+$/, '');
}

// 按播放顺序从 a 走到 b（循环时可以绕回开头），中间扔掉的规划帧（没过评审、没画出来）。
function droppedBetween(anim, a, b) {
  const frames = anim.frames;
  const out = [];
  const start = frames.indexOf(a);
  const end = frames.indexOf(b);
  if (start < 0 || end < 0) return out;
  for (let i = (start + 1) % frames.length; i !== end; i = (i + 1) % frames.length) {
    const frame = frames[i];
    if (!frame.inbetween && !frame.same && (frame.status === 'unpassed' || frame.status === 'failed' || !frameCandidate(anim, frame))) out.push(frame);
    if (out.length > frames.length) break;
  }
  return out;
}

// 放进 GIF 的帧：参考图本身和画好的帧。没过评审的帧不放：动作往反方向走、少了东西的一帧放进去，
// 播起来正好是那一下卡顿（真机 20261117-cd2dc5 第 2 帧手先往下掉再往上抬）。去掉之后少于 2 帧就照旧全放。
function playable(anim) {
  const all = anim.frames.filter((frame) => frame.same || frameCandidate(anim, frame));
  const good = all.filter((frame) => frame.same || frame.status !== 'unpassed');
  return good.length >= 2 ? good : all;
}

function summarizeFrames(anim) {
  const count = (status) => anim.frames.filter((frame) => !frame.same && frame.status === status).length;
  const parts = [];
  if (count('passed')) parts.push(count('passed') + ' 帧通过');
  if (count('unreviewed')) parts.push(count('unreviewed') + ' 帧没评审');
  if (count('unpassed')) parts.push(count('unpassed') + ' 帧没过评审');
  if (count('failed')) parts.push(count('failed') + ' 帧没画出来');
  const same = anim.frames.filter((frame) => frame.same).length;
  if (same) parts.push(same + ' 帧直接用参考图');
  return parts.join('，');
}

// 复用别的帧的帧，状态跟着被复用的那一帧走。
function syncMirrors(anim) {
  for (const frame of anim.frames) {
    const source = mirrorSource(anim, frame);
    if (!source) continue;
    frame.status = source.status;
    frame.problem = source.problem;
  }
}

function describeFrame(anim, frame) {
  if (frame.same) return '参考图本身';
  const source = mirrorSource(anim, frame);
  if (source) return '和第 ' + (anim.frames.indexOf(source) + 1) + ' 帧同一个姿态（直接用那一帧的图）';
  return (frame.inbetween ? '（程序补的中间帧）' : '') + frame.prompt;
}

// 按播放顺序一帧一帧画：每一帧要在上一帧上接着改，没法并行（见 framePrompt）。
async function generateFrames(session, image, ctx, deps, hooks, frames) {
  const order = image.animation.frames;
  const queue = frames.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b));
  for (const frame of queue) {
    if (ctx.stopped || hooks.isCancelled(session)) break;
    await generateFrame(session, image, frame, ctx, deps, hooks);
  }
}

// 这一帧画的时候送进去哪几张图、用哪种说法。
async function frameInputs(anim, frame, ctx, deps) {
  if (frame.inbetween && Array.isArray(frame.between)) {
    const [a, b] = frame.between.map((uid) => anim.frames.find((item) => item.uid === uid));
    const pa = a ? framePath(anim, a, ctx) : '';
    const pb = b ? framePath(anim, b, ctx) : '';
    if (pa && pb) return { mode: 'between', refs: [await uploadFrame(ctx, deps, pa), ctx.mm, await uploadFrame(ctx, deps, pb)] };
  }
  const previous = previousImage(anim, frame);
  if (previous) return { mode: 'chain', refs: [await uploadFrame(ctx, deps, previous), ctx.mm] };
  return { mode: 'ref', refs: [ctx.mm] };
}

function framePath(anim, frame, ctx) {
  if (frame.same) return ctx.ref.path;
  const candidate = frameCandidate(anim, frame);
  return candidate && !['failed', 'rejected', 'unpassed'].includes(frame.status) ? candidate.path : '';
}

// 往前找最近一张能用的帧；前一帧就是参考图本身（或者前面一张都没画成）时返回空：从参考图改。
function previousImage(anim, frame) {
  for (let i = anim.frames.indexOf(frame) - 1; i >= 0; i -= 1) {
    const other = anim.frames[i];
    if (other.same) return '';
    const path = framePath(anim, other, { ref: {} });
    if (path) return path;
  }
  return '';
}

// 帧的图是本地文件，送进接口前要上传换成 mm_file://；同一张只传一次。
async function uploadFrame(ctx, deps, path) {
  if (path === ctx.ref.path) return ctx.mm;
  if (!ctx.uploads) ctx.uploads = new Map();
  if (!ctx.uploads.has(path)) ctx.uploads.set(path, await h3.resolveReference(deps.config, path));
  return ctx.uploads.get(path);
}

async function generateFrame(session, image, frame, ctx, deps, hooks) {
  const anim = image.animation;
  const position = anim.frames.indexOf(frame) + 1;
  // executeAction 认的是「图」：给它一个只有这一帧的替身，候选按替身的 id 和轮次编号。
  const proxy = {
    id: image.id + 'F' + frame.uid,
    spec: { aspectRatio: ctx.aspect, area: ANIMATION.frameArea, size: '', refs: [ctx.mm], characterRefs: [], candidates: 1 },
    rounds: [{ index: 0 }],
    roundBase: frame.rounds,
  };
  frame.rounds += 1;
  frame.status = 'running';
  try {
    const inputs = await frameInputs(anim, frame, ctx, deps);
    frame.mode = inputs.mode;
    const action = { type: 'edit', prompt: framePrompt(frame, position, anim.frames.length, inputs.mode), refs: inputs.refs, parentId: null };
    const candidates = await hooks.executeAction(session, proxy, action, deps);
    if (!candidates.length) throw new Error('生图接口没有返回这一帧');
    const checked = await checkFrame(candidates[0], ctx, deps, action.prompt);
    frame.candidates.push(checked);
    frame.status = checked.problem ? 'rejected' : 'generated';
    frame.problem = checked.problem;
    frame.note = '';
  } catch (error) {
    frame.status = 'failed';
    frame.note = hooks.describeError(error);
    deps.emit(session, 'paint', image.id + ' 第 ' + position + ' 帧没画出来：' + frame.note, { level: 'error' });
    if (hooks.isFatal(error) || hooks.isContentPolicy(error)) {
      ctx.stopped = frame.note;
      if (hooks.isFatal(error)) session.fatal = frame.note;
    }
  }
}

// 程序校验：能不能解码、画幅对不对，顺手出一张 512 的预览（评审拼图和页面上的帧条都用它）。
// 和参考图几乎一模一样的帧，多半是模型没照指令改，直接判不合格。
async function checkFrame(candidate, ctx, deps, prompt) {
  const base = {
    id: candidate.id,
    file: candidate.file,
    path: candidate.path,
    previewFile: '',
    preview: '',
    width: 0,
    height: 0,
    requestId: candidate.requestId || '',
    prompt,
    refDiff: 0,
    problem: '',
    verdict: null,
    createdAt: Date.now(),
  };
  let decoded;
  try {
    decoded = decodeImage(candidate.buffer || (await readFile(candidate.path)));
  } catch {
    return { ...base, problem: '程序解不开这一帧的图片' };
  }
  const preview = downsample(decoded, ANIMATION.previewEdge);
  const previewFile = candidate.id + '.png';
  await writeFile(join(deps.dirs.previews, previewFile), encodePng(preview));
  const refAspect = ctx.width / ctx.height;
  const aspect = decoded.width / decoded.height;
  const refDiff = Number(meanGrayDiff(preview, ctx.preview).toFixed(2));
  let problem = '';
  if (Math.abs(aspect - refAspect) / refAspect > 0.03) problem = '画幅和参考图不一样（' + decoded.width + '×' + decoded.height + '）';
  else if (refDiff < 0.3) problem = '和参考图几乎一模一样，没画出这一帧要的变化';
  return { ...base, previewFile, preview: join(deps.dirs.previews, previewFile), width: decoded.width, height: decoded.height, refDiff, problem };
}

// 两张图缩成 64×64 灰度后的平均差（0–255）。
function meanGrayDiff(a, b) {
  const S = 64;
  const gray = (image, x, y) => {
    const px = Math.min(image.width - 1, Math.floor(((x + 0.5) * image.width) / S));
    const py = Math.min(image.height - 1, Math.floor(((y + 0.5) * image.height) / S));
    const o = (py * image.width + px) * image.channels;
    return image.channels >= 3 ? 0.299 * image.data[o] + 0.587 * image.data[o + 1] + 0.114 * image.data[o + 2] : image.data[o];
  };
  let sum = 0;
  for (let y = 0; y < S; y += 1) for (let x = 0; x < S; x += 1) sum += Math.abs(gray(a, x, y) - gray(b, x, y));
  return sum / (S * S);
}

async function reviewFrames(session, image, ctx, deps, hooks, frames) {
  const anim = image.animation;
  const shown = frames
    .filter((frame) => frame.status === 'generated')
    .map((frame) => ({ frame, position: anim.frames.indexOf(frame) + 1, candidate: latestCandidate(frame) }));
  if (!shown.length || hooks.isCancelled(session)) return;
  const sheetPath = join(deps.dirs.sheets, image.id + '-frames-' + Date.now() + '.png');
  const items = [{ path: ctx.previewPath, label: '0' }].concat(shown.map((item) => ({ path: item.candidate.preview, label: String(item.position) })));
  const grid = await buildGridSheet(items, sheetPath, { perRow: 4, width: ANIMATION.reviewWidth });
  // 拼图打开一次；看不清时还要打开单帧原图，按帧数给（每 4 帧 1 次）。
  // 固定 3 次不够：评审常先用一次 run_code 看文件，再 read 拼图和原图，第 4 次就被掐断，
  // 强制收尾时手上一张图都没有，只能判 fail（真机 20261115-d7e30e 的第 4 帧复核）。
  const budget = toolBudget('frames', {
    needs: [
      { count: 1, what: '拼图' },
      { count: Math.ceil(shown.length / 4), what: '单帧原图（每 4 帧 1 次）' },
    ],
    difficulty: difficultyOf(image).level,
    hits: hitsOf(image, 'frames'),
  });
  const instruction = [
    '你是H3-Image-Executor 的动图评审节点。用户要一张 GIF 动图：系统先定了一张参考图，再让模型一帧接着一帧改出来：',
    '第一帧从参考图改，后面每一帧在前一帧上只动一小步（参考图一直作为对照，锁住身份、服装、背景和颜色）。',
    '',
    '用户原话：',
    session.instruction,
    '',
    '看图材料：' + (grid.sheet || ctx.previewPath) + '（先用 read 打开它，多数时候看它就够了）。格子左上角的数字：0 是参考图，其余是帧号。',
    '拼图上看不清某一帧的细节，再 read 它的原图：',
    ...shown.map((item) => '第 ' + item.position + ' 帧 -> ' + item.candidate.path),
    '参考图原图 -> ' + ctx.ref.path,
    '只用 read 看图，不要用 run_code 或别的工具。',
    '',
    '整组按播放顺序是这样的（标「参考图本身」的帧不用评）：',
    ...anim.frames.map((frame, index) => '第 ' + (index + 1) + ' 帧：' + describeFrame(anim, frame)),
    '',
    '这次要评的帧：' + shown.map((item) => item.position).join('、') + '。逐帧核对四件事：',
    '1. 和参考图是同一个主体：外形、配色、五官、服装、画风一眼看出是同一个，没有变成另一个角色或换了画风。',
    '2. 背景、光线、构图，主体在画面里的位置和大小都和参考图一致：没有平移、缩放、裁切，背景没有换。',
    '3. 画出了这一帧要的变化，而且变化合理：没有多出或缺少肢体、手指，没有新加的物体、文字或水印。',
    '4. 参考图里有的东西这一帧都还在：文字、符号（比如头顶的问号）、道具一个都没少，也没有变成别的样子；少了就是 fail，',
    '   播起来这一帧会闪一下。',
    '再按帧号连起来看一遍：动作的先后顺序说得通，相邻两帧只差一小步，没有哪一帧突兀地跳出来（往反方向走、一下跳到很远）。',
    '前面帧里已经做出、按计划后面还要保持的变化（伞斜过来了、猫挪近了），看后面的帧有没有保持住；',
    '某一帧把前面的变化突然撤回（伞弹回原样、猫跳回原位），把那一帧判 fail。整组的问题出在哪一帧，就把那一帧判 fail。',
    '',
    '只输出一个 JSON 对象，不要解释、不要 markdown 代码块：',
    '{"seen":true,"frames":[{"index":2,"result":"pass","problem":"","prompt":""}],"sequence":{"ok":true,"problem":""},"summary":"一句话总结"}',
    '- seen：打开看到了看图材料写 true；没能打开、一张图都没看到写 false，frames 留空，不要凭空判 fail。',
    '- frames 里每一个要评的帧写一项，index 是帧号，result 只写 pass 或 fail。',
    '- fail 时 problem 写清哪里不对；prompt 写重画这一帧时给模型的新说法：写全这一帧和参考图相比要变的所有地方，',
    '  包括前面帧延续下来、这一帧要保持的状态（重画时模型会看到前一帧和参考图，但不知道计划里这一帧该是什么样），没变的部分不用写。',
    '工具调用上限 ' + budget.limit + ' 次。',
  ].join('\n');
  let data = null;
  const started = Date.now();
  try {
    const reviewed = await deps.agent.runJson(session, { step: 'frames', instruction, maxTools: budget.limit, budgetNote: budget.note });
    noteToolHit(image, 'frames', reviewed);
    ({ data } = reviewed);
  } catch (error) {
    deps.emit(session, 'judge', image.id + ' 动图评审没跑成：' + hooks.describeError(error) + '，这几帧按程序校验的结果交付', { level: 'warn' });
    for (const item of shown) item.frame.status = 'unreviewed';
    return;
  }
  // 没看到图给出的 fail 不是结论：照它重画只会白画一次，还会把画对了的帧标成没过评审。
  if (data && data.seen === false) {
    deps.emit(session, 'judge', image.id + ' 动图评审没看到图，这几帧按程序校验的结果交付', { level: 'warn', durMs: Date.now() - started });
    for (const item of shown) item.frame.status = 'unreviewed';
    return;
  }
  const results = Array.isArray(data && data.frames) ? data.frames : [];
  const lines = [];
  for (const item of shown) {
    const verdict = results.find((one) => one && Number(one.index) === item.position);
    if (!verdict) {
      item.frame.status = 'unreviewed';
      lines.push({ tag: 'warn', text: '第 ' + item.position + ' 帧：评审没给结论' });
      continue;
    }
    const pass = String(verdict.result || '').toLowerCase() === 'pass';
    const problem = String(verdict.problem || '').trim().slice(0, 300);
    item.candidate.verdict = { result: pass ? 'pass' : 'fail', problem };
    item.frame.status = pass ? 'passed' : 'rejected';
    item.frame.problem = pass ? '' : problem || '评审判这一帧不合格';
    item.frame.retryPrompt = pass ? '' : String(verdict.prompt || '').trim().slice(0, 600);
    lines.push({ tag: pass ? 'pass' : 'fail', text: '第 ' + item.position + ' 帧：' + (pass ? '通过' : item.frame.problem) });
  }
  const sequence = data && data.sequence && typeof data.sequence === 'object'
    ? { ok: data.sequence.ok !== false, problem: String(data.sequence.problem || '').trim().slice(0, 300) }
    : null;
  anim.reviews.push({ at: Date.now(), frames: shown.map((item) => item.position), summary: String((data && data.summary) || '').slice(0, 400), sequence, sheetFile: grid.sheet ? basename(grid.sheet) : '' });
  const failed = lines.filter((line) => line.tag === 'fail').length;
  deps.emit(session, 'judge', image.id + ' 动图评审：' + (shown.length - failed) + '/' + shown.length + ' 帧通过' + (sequence && !sequence.ok ? '；整组：' + sequence.problem : ''), {
    durMs: Date.now() - started,
    level: failed ? 'warn' : 'info',
    detail: detail('动图评审 · ' + image.id, [list('逐帧', lines), sequence ? kv('整组', sequence.ok ? '连起来说得通' : sequence.problem) : null, data && data.summary ? text('总结', data.summary) : null]),
  });
}

// ------------------------------------------------------------------ 追问：调动图本身

// 编辑节点写的 animation → 操作。帧号都是追问时页面上列出来的那套编号（从 1 开始）。
// from_panels 及以下几项是组图拼 GIF 用的（见 panelgif.mjs）：rows / cols / count 切格提示，first_ms / last_ms 第一格、
// 最后一格停多久，pingpong 来回播，bounce 切换时弹不弹。
export function normalizeAnimationOps(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const ints = (list) => (Array.isArray(list) ? list.map((value) => Math.round(Number(value))).filter((value) => value >= 1) : []);
  const grid = (value) => {
    const n = Math.round(Number(value));
    return n >= 1 && n <= 8 ? n : 0;
  };
  const ops = {
    start: raw.start === true,
    fromPanels: raw.from_panels === true || raw.fromPanels === true,
    rows: grid(raw.rows),
    cols: grid(raw.cols),
    count: Math.round(Number(raw.count)) >= 2 && Math.round(Number(raw.count)) <= 64 ? Math.round(Number(raw.count)) : 0,
    firstMs: clampMs(raw.first_ms ?? raw.firstMs),
    lastMs: clampMs(raw.last_ms ?? raw.lastMs),
    pingpong: typeof raw.pingpong === 'boolean' ? raw.pingpong : undefined,
    bounce: typeof raw.bounce === 'boolean' ? raw.bounce : undefined,
    // 组图拼 GIF 补不补过渡格（paneltween.mjs）：true 补（之前没补成的再试一次），false 不补。
    smooth: typeof raw.smooth === 'boolean' ? raw.smooth : undefined,
    // 程序转圈（motiongif.mjs）：{ type:'spin', center, radius, steps, frames, direction, ... }，只写了的项才改。
    motion: raw.motion && typeof raw.motion === 'object' && !Array.isArray(raw.motion) ? raw.motion : null,
    frameMs: clampMs(raw.frame_ms ?? raw.frameMs),
    loop: typeof raw.loop === 'boolean' ? raw.loop : undefined,
    edge: raw.edge ? clampEdge(raw.edge) : 0,
    transition: normalizeTransition(raw.transition),
    hold: (Array.isArray(raw.hold) ? raw.hold : []).map((item) => ({ index: Math.round(Number(item && item.index)), ms: clampMs(item && item.ms) })).filter((item) => item.index >= 1 && item.ms),
    drop: ints(raw.drop),
    order: ints(raw.order),
    redo: (Array.isArray(raw.redo) ? raw.redo : []).map((item) => ({ index: Math.round(Number(item && item.index)), prompt: String((item && item.prompt) || '').trim().slice(0, 600) })).filter((item) => item.index >= 1),
    add: (Array.isArray(raw.add) ? raw.add : []).map((item) => ({ after: Math.max(0, Math.round(Number(item && item.after) || 0)), prompt: String((item && item.prompt) || '').trim().slice(0, 600) })).filter((item) => item.prompt),
  };
  const any = ops.start || ops.fromPanels || ops.motion || hasAdjustments(ops) || ops.firstMs || ops.lastMs || ops.rows || ops.cols || ops.count ||
    ops.pingpong !== undefined || ops.bounce !== undefined || ops.smooth !== undefined;
  return any ? ops : null;
}

// 调动图本身的操作（不含 start）。
export function hasAdjustments(ops) {
  return Boolean(ops && (ops.frameMs || ops.loop !== undefined || ops.edge || ops.transition || ops.hold.length || ops.drop.length || ops.order.length || ops.redo.length || ops.add.length));
}

// 把操作并进规格和帧列表。返回改了什么（给事件流看）和要不要调生图（重画、加帧才要）。
export function applyAnimationOps(image, ops) {
  const spec = image.spec.animation;
  const anim = ensureState(image);
  const changes = [];
  if (ops.frameMs) {
    spec.frameMs = ops.frameMs;
    changes.push('每帧 ' + ops.frameMs + ' 毫秒');
  }
  if (ops.loop !== undefined) {
    spec.loop = ops.loop;
    changes.push(ops.loop ? '循环播放' : '只播一遍');
  }
  if (ops.edge) {
    spec.edge = ops.edge;
    changes.push('长边 ' + ops.edge + ' 像素');
  }
  if (ops.transition) {
    spec.transition = ops.transition;
    changes.push(ops.transition === 'cut' ? '帧和帧之间直接切换' : '帧和帧之间加渐变');
  }
  const original = anim.frames.slice();
  const at = (index) => original[index - 1] || null;
  for (const hold of ops.hold) {
    const frame = at(hold.index);
    if (!frame) continue;
    frame.holdMs = hold.ms;
    changes.push('第 ' + hold.index + ' 帧停 ' + hold.ms + ' 毫秒');
  }
  for (const redo of ops.redo) {
    const frame = at(redo.index);
    if (!frame) continue;
    if (redo.prompt) frame.prompt = redo.prompt;
    if (frame.same && !redo.prompt) continue;
    if (!redo.prompt && mirrorSource(anim, frame)) frame.own = true;
    frame.same = false;
    frame.status = 'pending';
    frame.problem = '';
    frame.retryPrompt = '';
    changes.push('重画第 ' + redo.index + ' 帧');
  }
  let order = original.slice();
  if (ops.order.length) {
    const picked = dedupeNumbers(ops.order).map(at).filter(Boolean);
    if (picked.length >= 2) {
      order = picked;
      changes.push('播放顺序改成 ' + dedupeNumbers(ops.order).filter((index) => at(index)).join('、'));
    }
  }
  if (ops.drop.length) {
    const dropped = new Set(ops.drop.map(at).filter(Boolean));
    const kept = order.filter((frame) => !dropped.has(frame));
    if (kept.length >= 2) {
      order = kept;
      changes.push('去掉第 ' + ops.drop.filter((index) => at(index)).join('、') + ' 帧');
    }
  }
  for (const add of ops.add.slice().sort((a, b) => b.after - a.after)) {
    const anchor = add.after ? at(add.after) : null;
    const position = anchor && order.includes(anchor) ? order.indexOf(anchor) + 1 : add.after === 0 ? 0 : order.length;
    if (order.length >= ANIMATION.maxFrames) break;
    order.splice(position, 0, newFrame(anim, { prompt: add.prompt, same: false, holdMs: 0 }));
    changes.push('第 ' + add.after + ' 帧后面加一帧');
  }
  if (order.some((frame) => !frame.same)) anim.frames = order;
  const regenerate = anim.frames.some((frame) => !frame.same && (frame.status === 'pending' || frame.status === 'failed'));
  return { changes, regenerate };
}

function dedupeNumbers(list) {
  return list.filter((value, index) => list.indexOf(value) === index);
}

// 编辑节点 inventory 里这张图的一段说明。
export function animationInventory(image) {
  const spec = image.spec.animation;
  const anim = image.animation;
  const frames = anim && anim.frames.length ? anim.frames : spec.frames;
  const describe = frames
    .map((frame, index) => {
      const source = anim && mirrorSource(anim, frame);
      if (frame.same) return '第 ' + (index + 1) + ' 帧（参考图本身）';
      if (source) return '第 ' + (index + 1) + ' 帧（和第 ' + (anim.frames.indexOf(source) + 1) + ' 帧同一个姿态，用同一张图）';
      return '第 ' + (index + 1) + ' 帧「' + clip(frame.prompt, 40) + '」' + (frame.status && frame.status !== 'passed' ? '（' + FRAME_STATUS[frame.status] + '）' : '');
    })
    .join('；');
  const timing = '每帧 ' + spec.frameMs + ' 毫秒，' + (spec.loop ? '循环' : '只播一遍') + '，' + (transitionOf(spec) === 'cut' ? '帧间直接切换' : '帧间渐变') + '，长边 ' + spec.edge + ' 像素';
  if (!anim || anim.state === 'awaiting_confirm' || !anim.state) {
    return '；这是 GIF 的参考图，还没出帧（计划 ' + frames.length + ' 帧，' + timing + '）：' + describe;
  }
  return '；这是 GIF（' + frames.length + ' 帧，' + timing + '）：' + describe;
}

const FRAME_STATUS = {
  pending: '还没画',
  running: '正在画',
  generated: '还没评审',
  rejected: '没过评审',
  unpassed: '没过评审',
  unreviewed: '没评审',
  failed: '没画出来',
};

function clip(value, limit) {
  const chars = Array.from(String(value || ''));
  return chars.length > limit ? chars.slice(0, limit).join('') + '…' : chars.join('');
}

// ------------------------------------------------------------------ 交付

// 实际写进 GIF 的关键帧和时长。循环播放时最后一帧之后直接接回第 1 帧：两帧是同一张图（规划常在末尾
// 再放一帧参考图当「回到起手」），原样写进去接缝处会连停两帧。20261115-d7e30e 首尾各停 600 毫秒，
// 每一轮都在参考图上卡 1.2 秒。并成一帧，停两者里长的那个。
// 时长按「份」分，整组时长等于规划的帧数 × frame_ms（写了 hold_ms 的帧照它停）：
// - 播放的每一帧一份。补的过渡帧也是一份：补了帧的那一步变慢、变顺，别的帧不会只剩一半时间
//   （以前过渡帧和原来那一帧分掉一步的时间，有的帧 180 毫秒、有的 60 毫秒，播起来忽快忽慢，真机 20261117-cd2dc5）；
// - 扔掉的帧（没过评审、没画出来）的那一份留给它前面那一帧：亮点照计划的速度走，不会一帧跳一格、一帧跳三格
//   （以前扔掉的帧不占时间，真机 20261119-e645c0 扔了一半的帧，后面的转动快了一倍多）。空当里补了过渡帧的，
//   过渡帧顶替扔掉的帧那一份，不再多占。
function playOrder(usable, anim, spec) {
  const shown = new Set(usable.map((item) => item.frame));
  // 按播放顺序把帧分成一段一段：每段从一帧要播的规划帧开始，带着它后面的过渡帧和扔掉的规划帧，到下一帧要播的规划帧为止。
  const gaps = [];
  let current = null;
  // 第一帧要播的规划帧之前的帧（一般没有：第 1 帧多是参考图本身）算进最后一段，循环时绕回来。
  const before = { extras: [], dropped: 0 };
  for (const frame of anim.frames) {
    const kept = shown.has(frame);
    const into = current || before;
    if (!frame.inbetween && kept) {
      current = { lead: frame, extras: [], dropped: 0 };
      gaps.push(current);
    } else if (!frame.inbetween) {
      into.dropped += 1;
    } else if (kept) {
      into.extras.push(frame);
    }
  }
  if (gaps.length) {
    gaps[gaps.length - 1].dropped += before.dropped;
    gaps[gaps.length - 1].extras.push(...before.extras);
  }
  const shares = new Map();
  let units = 0;
  for (const gap of gaps) {
    const frames = [gap.lead, ...gap.extras];
    const count = Math.max(1 + gap.dropped, frames.length);
    const each = count / frames.length;
    for (const frame of frames) {
      if (frame.holdMs) continue;
      shares.set(frame, each);
      units += each;
    }
  }
  const planned = anim.frames.filter((frame) => !frame.inbetween && !frame.holdMs).length;
  const unit = units ? (spec.frameMs * Math.max(1, planned)) / units : spec.frameMs;
  const order = usable.map((item) => ({
    item,
    delay: item.frame.holdMs || Math.max(ANIMATION.minFrameMs, Math.round(unit * (shares.get(item.frame) || 1))),
  }));
  if (spec.loop && order.length > 2 && sameImage(order[0].item, order[order.length - 1].item)) {
    const last = order.pop();
    order[0].delay = Math.max(order[0].delay, last.delay);
  }
  return order;
}

function medianDelay(order) {
  const free = order.filter((entry) => !entry.item.frame.holdMs).map((entry) => entry.delay).sort((x, y) => x - y);
  if (!free.length) return order[0].delay;
  return free[free.length >> 1];
}

function sameImage(a, b) {
  if (a.frame.same || b.frame.same) return a.frame.same && b.frame.same;
  return Boolean(a.candidate && b.candidate && a.candidate.id === b.candidate.id);
}

function describeComposition(gif, order, usable) {
  const parts = [];
  const locked = (gif.locked || []).filter((info) => info && info.locked).length;
  if (locked) parts.push(locked + ' 帧锁回参考图的背景');
  const inbetween = usable.filter((item) => item.frame.inbetween).length;
  if (inbetween) parts.push('含 ' + inbetween + ' 帧程序补的过渡帧');
  if (gif.tweens) parts.push('补了 ' + gif.tweens + ' 帧渐变');
  if (gif.cuts) parts.push(gif.cuts + ' 处两帧差得多、没补渐变（叠出来是虚影）');
  if (order.length < usable.length) parts.push('首尾同一张图并成一帧');
  parts.push(gif.frameCount + ' 帧 ' + Math.round(gif.buffer.length / 1024) + ' KB');
  return parts.join('，');
}

// 合成 GIF 并写进这一版交付目录：<base>.gif、静态图 <base>.<ext>（参考图本身，之后改画面从它开始）、
// 预览 <base>-preview.png、帧条 <base>-frames.png。合成完从写出去的 GIF 读回来核对帧数、尺寸、时长和循环。
export async function deliverAnimation(session, image, deps, hooks, out) {
  const anim = image.animation;
  const spec = image.spec.animation;
  const notes = [];
  const ref = (session.refs || []).find((item) => item.id === anim.refId);
  const used = new Set(playable(anim));
  const usable = anim.frames
    .map((frame, index) => ({ frame, position: index + 1, candidate: frameCandidate(anim, frame) }))
    .filter((item) => used.has(item.frame));
  if (anim.state !== 'done' || !ref || usable.length < 2) {
    return {
      item: { id: image.id, title: image.title, status: 'failed', blocked: false, reason: 'GIF 没做成：' + (anim.error || '能用的帧不到 2 帧'), contentPolicy: false, rounds: anim.reviews.length },
      notes,
    };
  }
  const size = gifSize(anim.width, anim.height, spec.edge);
  const order = playOrder(usable, anim, spec);
  const transition = transitionOf(spec);
  const gif = await hooks.queuePixelWork(async () => {
    const base = fitFrame(decodeImage(await readFile(ref.path)), size.width, size.height);
    const decoded = new Map();
    const frames = [];
    for (const entry of order) {
      if (entry.item.frame.same) {
        frames.push(base);
        continue;
      }
      const path = entry.item.candidate.path;
      if (!decoded.has(path)) decoded.set(path, fitFrame(decodeImage(await readFile(path)), size.width, size.height));
      frames.push(decoded.get(path));
    }
    return makeGif(frames, {
      width: size.width,
      height: size.height,
      frameMs: spec.frameMs,
      delays: order.map((entry) => entry.delay),
      loop: spec.loop,
      base,
      tween: transition === 'fade' ? ANIMATION.tween : 0,
      tweenMaxChange: ANIMATION.tweenMaxChange,
    });
  });
  deps.emit(session, 'deliver', image.id + ' 合成 GIF：' + describeComposition(gif, order, usable), {
    detail: detail('GIF 合成 · ' + image.id, [
      kv('关键帧', order.map((entry) => '第 ' + entry.item.position + ' 帧 ' + entry.delay + ' 毫秒').join('，')),
      kv('写出', gif.frameCount + ' 帧（含 ' + gif.tweens + ' 帧渐变），' + Math.round(gif.buffer.length / 1024) + ' KB'),
      list(
        '锁背景',
        order
          .map((entry, index) => ({ entry, info: gif.locked && gif.locked[index] }))
          .filter((one) => one.info)
          .map((one) => ({
            text:
              '第 ' + one.entry.item.position + ' 帧：' + (one.info.locked ? '变化区域占 ' + Math.round(one.info.area * 100) + '%' : '整幅都在变（' + Math.round(one.info.area * 100) + '%），没锁') +
              (one.info.dx || one.info.dy || one.info.scale ? '，对齐挪了 (' + one.info.dx + ', ' + one.info.dy + ') 像素、缩放 ' + one.info.scale + '%' : ''),
          })),
      ),
    ]),
  });
  const gifName = out.base + '.gif';
  await writeFile(join(out.dir, gifName), gif.buffer);
  const back = decodeGif(await readFile(join(out.dir, gifName)));
  const durationMs = back.frames.reduce((sum, frame) => sum + frame.delayMs, 0);
  const verify = {
    ok: back.width === gif.width && back.height === gif.height && back.frames.length === gif.frameCount && (spec.loop ? back.loop === 0 : back.loop === null),
    frames: back.frames.length,
    width: back.width,
    height: back.height,
    durationMs,
    loop: back.loop === 0,
  };
  const stillName = out.base + (extname(ref.file) || '.png');
  await copyFile(ref.path, join(out.dir, stillName));
  const previewName = out.base + '-preview.png';
  const refPreview = join(deps.dirs.previews, ref.id + '-gif.png');
  let previewFile = null;
  if (await exists(refPreview)) {
    await copyFile(refPreview, join(out.dir, previewName));
    previewFile = out.version + '/' + previewName;
  }
  const stripName = out.base + '-frames.png';
  const strip = await buildGridSheet(
    usable.map((item) => ({ path: item.frame.same ? (previewFile ? refPreview : ref.path) : item.candidate.preview || item.candidate.path, label: String(item.position) })),
    join(out.dir, stripName),
    // 每行最多 6 格，行与行尽量一样长：8 帧排成 4+4，不排成 6+2。
    { perRow: Math.ceil(usable.length / Math.ceil(usable.length / 6)), width: 1200, fill: 246 },
  );
  const missing = anim.frames.filter((frame) => !frame.same && !frameCandidate(anim, frame));
  const unpassed = anim.frames.filter((frame) => !frame.same && !mirrorSource(anim, frame) && frameCandidate(anim, frame) && frame.status !== 'passed');
  const number = (frame) => anim.frames.indexOf(frame) + 1;
  if (missing.length) notes.push(image.id + ' 的 GIF 少了第 ' + missing.map(number).join('、') + ' 帧（没画出来），可以说「第 ' + number(missing[0]) + ' 帧重画」再试');
  if (unpassed.length) {
    const skipped = unpassed.filter((frame) => !used.has(frame));
    notes.push(
      image.id + ' 的 GIF 里第 ' + unpassed.map(number).join('、') + ' 帧' + (unpassed.some((frame) => frame.status === 'unpassed') ? '没过评审' : '没评审') +
        (unpassed[0].problem ? '（' + unpassed[0].problem + '）' : '') +
        (skipped.length ? '，第 ' + skipped.map(number).join('、') + ' 帧没放进 GIF' : '') +
        '，可以说「第 ' + number(unpassed[0]) + ' 帧重画」',
    );
  }
  if (!verify.ok) notes.push(image.id + ' 的 GIF 读回来核对没通过（' + verify.frames + ' 帧，' + verify.width + '×' + verify.height + '）');
  const clean = !missing.length && !unpassed.length && verify.ok;
  const item = {
    id: image.id,
    title: image.title,
    status: clean ? 'passed' : 'unpassed',
    candidateId: null,
    file: out.version + '/' + stillName,
    previewFile,
    size: anim.width + 'x' + anim.height,
    requestId: '',
    reason: clean ? '每一帧都过了动图评审，GIF 读回来核对通过' : '',
    rounds: anim.reviews.length,
    verdict: null,
    program: null,
    prompt: '',
    revisedPrompt: '',
    qr: null,
    text: null,
    baseFile: null,
    interrupted: image.interrupted || '',
    gif: {
      file: out.version + '/' + gifName,
      strip: strip.sheet ? out.version + '/' + stripName : null,
      width: gif.width,
      height: gif.height,
      bytes: gif.buffer.length,
      frames: usable.length,
      frameMs: spec.frameMs,
      loop: spec.loop,
      transition,
      written: gif.frameCount,
      durationMs,
      // 一帧实际停多久：补了过渡帧、去掉了没过评审的帧之后，和规划写的 frame_ms 不一样（见 playOrder）。
      // 扔掉了帧的那几帧停得更久（见 playOrder），报中位数。
      keyMs: medianDelay(order),
      // 程序补的中间姿态有几帧；两帧差得多、没补渐变的有几处。
      inbetween: usable.filter((item) => item.frame.inbetween).length,
      cuts: gif.cuts || 0,
      dither: gif.dither,
      reference: ref.id,
      verify,
      items: anim.frames.map((frame, index) => ({
        index: index + 1,
        prompt: frame.same ? '' : frame.prompt,
        same: frame.same,
        status: frame.same ? 'reference' : frameCandidate(anim, frame) ? frame.status : 'failed',
        problem: frame.problem || frame.note || '',
        holdMs: frame.holdMs || 0,
        inbetween: Boolean(frame.inbetween),
        mode: frame.mode || '',
        // 没过评审、没放进 GIF 的帧
        skipped: !frame.same && frame.status === 'unpassed' && !used.has(frame),
        mirrorOf: mirrorSource(anim, frame) ? anim.frames.indexOf(mirrorSource(anim, frame)) + 1 : 0,
        candidateId: (frameCandidate(anim, frame) || {}).id || null,
      })),
    },
    animation: { state: 'done' },
  };
  return { item, notes };
}

// 参考图交付时挂在卡片上的那一段：计划出几帧、每帧什么样。
export function awaitingInfo(image) {
  const spec = image.spec.animation;
  const anim = ensureState(image);
  return {
    state: 'awaiting_confirm',
    confirm: confirmText(image.id),
    frameMs: spec.frameMs,
    loop: spec.loop,
    edge: spec.edge,
    frames: anim.frames.map((frame, index) => ({ index: index + 1, same: frame.same, prompt: frame.same ? '' : frame.prompt })),
  };
}

// 落盘：帧候选只存文件名，路径在恢复时按会话目录重建。
export function snapshotAnimation(anim) {
  if (!anim) return null;
  return {
    state: anim.state,
    refId: anim.refId,
    refFile: anim.refFile,
    width: anim.width,
    height: anim.height,
    nextUid: anim.nextUid,
    error: anim.error || '',
    reviews: anim.reviews || [],
    frames: anim.frames.map((frame) => ({
      uid: frame.uid,
      prompt: frame.prompt,
      same: frame.same,
      holdMs: frame.holdMs,
      status: frame.status,
      problem: frame.problem,
      retryPrompt: frame.retryPrompt,
      note: frame.note,
      own: Boolean(frame.own),
      rounds: frame.rounds,
      inbetween: Boolean(frame.inbetween),
      between: frame.between || null,
      mode: frame.mode || '',
      candidates: frame.candidates.map((candidate) => ({
        id: candidate.id,
        file: candidate.file,
        previewFile: candidate.previewFile,
        width: candidate.width,
        height: candidate.height,
        requestId: candidate.requestId,
        prompt: candidate.prompt,
        refDiff: candidate.refDiff,
        problem: candidate.problem,
        verdict: candidate.verdict,
        createdAt: candidate.createdAt,
      })),
    })),
  };
}

const SAFE = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/;

export function restoreAnimation(raw, dirs) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.frames)) return null;
  // 出帧做到一半进程被停了：没画完的帧回到待画，下次追问「继续」或重画时接着画。
  const state = raw.state === 'frames' ? 'failed' : String(raw.state || '');
  return {
    state,
    refId: String(raw.refId || ''),
    refFile: SAFE.test(String(raw.refFile || '')) ? raw.refFile : '',
    width: Number(raw.width) || 0,
    height: Number(raw.height) || 0,
    nextUid: Number(raw.nextUid) || raw.frames.length + 1,
    error: raw.state === 'frames' ? '出帧时应用被关掉了' : String(raw.error || ''),
    reviews: Array.isArray(raw.reviews) ? raw.reviews : [],
    frames: raw.frames.map((frame) => ({
      uid: Number(frame.uid) || 0,
      prompt: String(frame.prompt || ''),
      same: Boolean(frame.same),
      holdMs: Number(frame.holdMs) || 0,
      status: frame.status === 'running' ? 'pending' : String(frame.status || 'pending'),
      problem: String(frame.problem || ''),
      retryPrompt: String(frame.retryPrompt || ''),
      note: String(frame.note || ''),
      own: Boolean(frame.own),
      rounds: Number(frame.rounds) || 0,
      inbetween: Boolean(frame.inbetween),
      between: Array.isArray(frame.between) ? frame.between.map(Number).filter((uid) => uid > 0).slice(0, 2) : null,
      mode: ['ref', 'chain', 'between'].includes(frame.mode) ? frame.mode : '',
      candidates: (Array.isArray(frame.candidates) ? frame.candidates : [])
        .filter((candidate) => candidate && SAFE.test(String(candidate.file || '')))
        .map((candidate) => ({
          ...candidate,
          path: join(dirs.images, candidate.file),
          preview: SAFE.test(String(candidate.previewFile || '')) ? join(dirs.previews, candidate.previewFile) : '',
        })),
    })),
  };
}
