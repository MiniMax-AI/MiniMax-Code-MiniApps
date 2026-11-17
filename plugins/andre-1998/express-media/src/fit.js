// 核心：把一个视频压到「能发出去」的体积。
//
// 设计上只有一条硬规矩：**不量就别说成功**。
// 每一次编码之后都用 ffprobe 量真实体积，超了才算下一档；宁可报「压不进去」也不交一个超限文件。
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from './ffmpeg.js';
import { probe } from './probe.js';
import { analyzeContent, KINDS } from './classify.js';
import { resolveTarget } from './format.js';

const PRESET_CAPS = { keep: Infinity, balanced: 1920, small: 1280 };
const IM_VIDEO_CODECS = new Set(['h264']);
const IM_AUDIO_CODECS = new Set(['aac', 'mp3', 'none']);

function even(n) { const v = Math.round(n); return v % 2 === 0 ? v : v + 1; }

/** 按长边上限等比缩到偶数；不放大。 */
export function capLongSide(w, h, cap) {
  if (!w || !h) return { w: null, h: null };
  const long = Math.max(w, h);
  if (long <= cap) return { w: even(w), h: even(h) };
  const k = cap / long;
  return { w: even(w * k), h: even(h * k) };
}

/** 降一档分辨率：长边 ×0.75，够狠又不至于掉到马赛克。 */
export function stepDown({ w, h }, factor = 0.75) {
  return { w: even(w * factor), h: even(h * factor) };
}

export function resolutionLadder(w, h, preset = 'balanced', { minLong = 360 } = {}) {
  const cap = PRESET_CAPS[preset] ?? PRESET_CAPS.balanced;
  const start = capLongSide(w, h, cap);
  const steps = [start];
  let cur = start;
  while (steps.length < 8) {
    const next = stepDown(cur);
    if (Math.max(next.w, next.h) < minLong) break;
    steps.push(next);
    cur = next;
  }
  return steps;
}

export function fpsCap(sourceFps, preset = 'balanced') {
  if (!sourceFps) return null;
  // 24fps 这种本来就低的保持原样——把 24 拉到 30 只会浪费体积
  if (sourceFps <= 30.5) return Math.round(sourceFps * 100) / 100;
  return preset === 'keep' ? 60 : 30;
}

/** 旋转的像素处理：宁可把方向烤进画面，也别指望每个 IM 客户端都认 display matrix。 */
export function rotationFilter(rotation) {
  switch (((Number(rotation) || 0) % 360 + 360) % 360) {
    case 90: return 'transpose=1';
    case 180: return 'hflip,vflip';
    case 270: return 'transpose=2';
    default: return null;
  }
}

/**
 * 裁剪用输出选项 `-ss` / `-t`，**不要用 `trim` 滤镜**。
 *
 * 实测踩过的坑：ffmpeg 9.0.2 上 `-vf trim=0:12.5` 根本不裁剪，产出仍是完整的 25 秒；
 * 而 `-t 12.5` 正确给出 12.5 秒。所以「为了快而改用滤镜」这个优化是倒退——
 * 它既没更快，还悄悄丢掉了裁剪语义。
 *
 * 语义对齐 trim.js：`start > 0` 时把 `-ss` 放 `-i` 之前（快速定位），
 * `-t` 放在输出侧表示「定位之后再取多少秒」，两者相加就是区间长度。
 */
export function trimArgs({ start = 0, end = null, duration = null }) {
  const args = { seek: null, take: null };
  if (start > 0) args.seek = start;
  if (duration !== null && duration !== undefined && duration > 0) args.take = duration;
  else if (end !== null && end !== undefined && end > start) args.take = end - start;
  return args;
}

export function buildFilter({ width, height, rotation }) {
  const parts = [];
  const tf = rotationFilter(rotation);
  const hadRotation = Boolean(tf);
  if (tf) parts.push(tf);
  if (width && height) parts.push(`scale=${width}:${height}:flags=lanczos`, 'setsar=1');
  // 关键：像素转正之后，必须把容器里的显示矩阵删掉。
  // 只做 transpose 是不够的——实测 ffmpeg 会把输入的 display matrix 一路带到输出，
  // 结果播放器再转一次，竖屏视频发出去是躺着的（而 -metadata rotate=0 只写老式 tag，管不到矩阵）。
  if (hadRotation) parts.push('sidedata=mode=delete:type=DISPLAYMATRIX');
  return parts.length ? parts.join(',') : null;
}

function videoArgs({ width, height, fps, crf, bitrateBps, rotation, speed }) {
  const args = [];
  const vf = buildFilter({ width, height, rotation });
  if (vf) args.push('-vf', vf);
  args.push('-c:v', 'libx264', '-preset', speed, '-pix_fmt', 'yuv420p', '-profile:v', 'high');
  if (bitrateBps) {
    args.push('-b:v', String(Math.round(bitrateBps)));
    args.push('-maxrate', String(Math.round(bitrateBps * 1.25)));
    args.push('-bufsize', String(Math.round(bitrateBps * 2)));
  } else {
    args.push('-crf', String(crf));
  }
  if (fps) args.push('-r', String(fps));
  return args;
}

function audioArgs(audio) {
  if (!audio.present) return ['-an'];
  return ['-c:a', 'aac', '-b:a', `${audio.kbps}k`, '-ac', String(audio.channels || 2), '-ar', '48000'];
}

/** 单遍编码的参数（抽出来是为了能在单测里逐条断言参数） */
export function encodeArgs({ input, output, width, height, fps, crf, bitrateBps, audio, rotation, speed = 'medium', trim = null }) {
  const t = trim ? trimArgs(trim) : { seek: null, take: null };
  return [
    '-nostdin', '-v', 'error', '-y', '-noautorotate',
    ...(t.seek !== null ? ['-ss', String(t.seek)] : []),
    '-i', input,
    ...videoArgs({ width, height, fps, crf, bitrateBps, rotation, speed }),
    ...(t.take !== null ? ['-t', String(t.take)] : []),
    ...audioArgs(audio),
    '-metadata:s:v:0', 'rotate=0', '-movflags', '+faststart', output,
  ];
}

/** 两遍编码要跑两个进程：第二遍的码率分配依赖第一遍写出的统计文件 */
export function twoPassArgsList({ input, output, width, height, fps, bitrateBps, audio, rotation, speed = 'medium', trim = null, logPrefix }) {
  const t = trim ? trimArgs(trim) : { seek: null, take: null };
  const common = ['-nostdin', '-v', 'error', '-y', '-noautorotate',
    ...(t.seek !== null ? ['-ss', String(t.seek)] : []), '-i', input,
    ...videoArgs({ width, height, fps, crf: null, bitrateBps, rotation, speed })];
  const pass1 = [...common, ...(t.take !== null ? ['-t', String(t.take)] : []), '-pass', '1', '-passlogfile', logPrefix, '-an', '-f', 'mp4', os.devNull];
  const pass2 = [...common, ...(t.take !== null ? ['-t', String(t.take)] : []), '-pass', '2', '-passlogfile', logPrefix, '-metadata:s:v:0', 'rotate=0', '-movflags', '+faststart', output];
  return [pass1, pass2];
}

function audioPlan(info, targetBytes) {
  const channels = info.audio.channels || 2;
  if (!info.audio.present) return { present: false, kbps: 0, channels: 2, estimatedBytes: 0 };
  // 目标极小时直接丢音频——省下的体积比降分辨率还多
  if (targetBytes < 512 * 1024) return { present: false, kbps: 0, channels, estimatedBytes: 0, dropped: true };
  const kbps = targetBytes < 2 * 1024 * 1024 ? 64 : 96;
  return {
    present: true, kbps,
    channels: channels > 2 ? 2 : channels,
    estimatedBytes: Math.ceil((kbps * 1000 * (info.durationSec || 0)) / 8),
  };
}

/**
 * 体积估算：只用来排「这一档值不值得试」，最终判定一律以实测为准。
 *
 * 对着合成素材标定的结果：camera 档的模型值 0.050 / 实测 0.0504，几乎正中；
 * screen 和 motion 两档的合成素材不具代表性（一个是纯色暗背景，一个是纯色方块，
 * 都比真实内容好压一个量级），所以没有拿它们去反推模型——那会让模型对真实内容更不准。
 *
 * 正因为跨内容类型的偏差能到几倍，调用方应该把它当**区间**展示，而不是一个精确数字。
 */
export function estimateBytes({ width, height, fps, crf, kind, durationSec, audioBytes = 0 }) {
  const k = KINDS[kind] || KINDS.camera;
  // bpp 随 CRF 下滑的经验曲线，够用来排顺序，不用来承诺结果
  const bpp = Math.max(0.004, k.minBpp * Math.pow(0.86, crf - k.crfStart));
  const videoBytes = Math.ceil((width * height * fps * bpp * (durationSec || 0)) / 8);
  return videoBytes + audioBytes;
}

/** 估算区间。宁可给一个宽区间，也不要给一个看着精确、实际偏乐观 35% 的数字。 */
export function estimateRange(args) {
  const mid = estimateBytes(args);
  return { low: Math.round(mid * 0.5), high: Math.round(mid * 1.8) };
}

function publicPass(plan) {
  return {
    width: plan.width, height: plan.height, fps: plan.fps, crf: plan.crf ?? null,
    bitrateBps: plan.bitrateBps ?? null, audioKbps: plan.audio.present ? plan.audio.kbps : 0,
    hasAudio: plan.audio.present,
  };
}

async function runEncode(ffmpegPath, argsList, { onProgress, durationSec, signal }) {
  let last = null;
  for (const args of argsList) {
    last = await run(ffmpegPath, args, { onProgress, durationSec, signal });
    if (last.code !== 0) return last;
  }
  return last;
}

function makeLogPrefix() {
  return path.join(os.tmpdir(), `express-2pass-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
}

function cleanupPassLogs(prefix) {
  if (!prefix) return;
  let entries = [];
  try { entries = readdirSync(path.dirname(prefix)); } catch { return; }
  const base = path.basename(prefix);
  for (const f of entries) {
    if (f.startsWith(base)) { try { unlinkSync(path.join(path.dirname(prefix), f)); } catch { /* 清理失败无所谓 */ } }
  }
}

/**
 * 主流程。
 * @returns 每一档的参数、实测体积、最终判定，以及「压不进去」时给出的替代方案。
 */
export async function fit(input, opts = {}) {
  const {
    to, preset = 'balanced', out, ffmpeg, ffprobe,
    speed = 'medium', maxPasses = 4, signal, onProgress,
    onPass = () => {}, dryRun = false, trim = null,
    // normalize = 即使体积已经达标也重编码一遍：把方向烤进像素、统一容器。
    // 默认关掉是因为「直接复制」既无损又快，没必要为了统一而重压一次。
    normalize = false,
  } = opts;

  if (!ffmpeg?.path) throw new Error('缺少 ffmpeg 路径，先跑 express doctor');
  if (!existsSync(input)) throw new Error(`文件不存在：${input}`);

  const target = resolveTarget(to);
  const info = await probe(input, { ffprobe });
  if (!info.video.present) throw new Error(`这个文件里没有视频轨：${input}`);

  const content = await analyzeContent(input, {
    ff: ffmpeg.path,
    durationSec: info.durationSec,
    // 用「观看者看到的尺寸」采样：竖屏带旋转元数据时，原始宽高和显示宽高是互换的
    width: info.video.displayWidth,
    height: info.video.displayHeight,
  });
  const k = KINDS[content.kind] || KINDS.camera;
  const outPath = out || defaultOutPath(input, target, preset);
  // 目录必须在第一次写文件之前就建好：中间档的临时文件也是往这儿写的，
  // 等到 produce() 再建的话，前面每一次编码都会因为「打不开输出文件」而失败。
  mkdirSync(path.dirname(outPath), { recursive: true });
  const base = { input, inputInfo: info, target, content, preset, speed, out: outPath };

  // —— 情况 1：本来就发得出去，而且格式是各家都认的 ——
  // normalize 会跳过这条捷径：用户明确要求把方向/容器统一好
  if (info.sizeBytes <= target.hardBytes && !trim && !normalize) {
    const friendly = IM_VIDEO_CODECS.has(info.video.codec) && IM_AUDIO_CODECS.has(info.audio.present ? info.audio.codec : 'none');
    if (friendly) {
      // 体积达标时保持无损（直接复制）。但如果它带旋转元数据，得说清楚：
      // 有些客户端不认 display matrix，收到的是躺着的大文件——那不叫「能发」。
      const warnings = [];
      if (info.video.rotation !== 0) {
        warnings.push(
          `这个文件靠旋转元数据（${info.video.rotation}°）摆正，体积达标所以保持了原样、没有重编码。` +
          '个别客户端不认这个元数据，收到会横着显示。真遇到了就加 --normalize 强制把方向烤进像素。',
        );
      }
      if (info.video.hdr) {
        warnings.push('这是 HDR 视频，部分平台和播放器会显示成偏色。发之前最好确认一下对方看得到。');
      }
      if (dryRun) {
        return finish({ ...base, action: 'copy', output: outPath, before: info.sizeBytes, after: info.sizeBytes, passes: [], afterInfo: info, dryRun: true });
      }
      await produce(input, outPath, ffmpeg, { copy: true });
      return finish({ ...base, action: 'copy', output: outPath, before: info.sizeBytes, after: statSync(outPath).size, passes: [], afterInfo: await probe(outPath, { ffprobe }), warnings });
    }
    // 体积过关但格式不吃香（比如 HEVC/MKV），继续走重编码
  }

  const ladder = resolutionLadder(info.video.displayWidth, info.video.displayHeight, preset);
  const fps = fpsCap(info.video.fps, preset);
  const audio = audioPlan(info, target.aimBytes);
  const passes = [];

  let crf = k.crfStart;
  let resIdx = 0;
  let bitrateBps = null;
  let best = null;

  // dry-run 要把整条阶梯走完（观众要知道「最坏情况下会试到哪」），不受 maxPasses 限制
  while (passes.length < (dryRun ? Number.POSITIVE_INFINITY : maxPasses)) {
    const { w, h } = ladder[resIdx];
    const plan = { width: w, height: h, fps, crf, bitrateBps, audio, rotation: info.video.rotation, speed, trim };
    const predicted = estimateBytes({ ...plan, kind: content.kind, durationSec: info.durationSec, audioBytes: audio.estimatedBytes });

    if (dryRun) {
      passes.push({ ...publicPass(plan), predictedBytes: predicted, measuredBytes: null, done: false });
      onPass({ type: 'plan', ...publicPass(plan), predictedBytes: predicted });
      if (bitrateBps) break;
      if (crf < k.maxCrf) crf = Math.min(k.maxCrf, crf + k.crfStep);
      else if (resIdx < ladder.length - 1) { resIdx += 1; crf = k.crfStart; }
      else break;
      continue;
    }

    const tmp = `${outPath}.p${passes.length + 1}.tmp.mp4`;
    const logPrefix = bitrateBps ? makeLogPrefix() : null;
    const argsList = bitrateBps
      ? twoPassArgsList({ input, output: tmp, width: w, height: h, fps, bitrateBps, audio, rotation: info.video.rotation, speed, trim, logPrefix })
      : [encodeArgs({ input, output: tmp, width: w, height: h, fps, crf, audio, rotation: info.video.rotation, speed, trim })];

    const t0 = Date.now();
    const { code, stderr } = await runEncode(ffmpeg.path, argsList, { onProgress, durationSec: info.durationSec, signal });
    if (logPrefix) cleanupPassLogs(logPrefix);

    const measured = existsSync(tmp) ? statSync(tmp).size : null;
    const record = {
      ...publicPass(plan), predictedBytes: predicted, measuredBytes: measured,
      seconds: Math.round(((Date.now() - t0) / 1000) * 10) / 10, done: true,
      error: code === 0 ? null : (stderr || '').trim().slice(0, 300),
      tmp,
    };
    passes.push({ ...record, tmp: undefined });
    onPass({ type: 'done', ...record });

    if (code !== 0 || measured === null) {
      if (best) break;
      if (resIdx < ladder.length - 1) { resIdx += 1; crf = k.crfStart; bitrateBps = null; continue; }
      break;
    }

    if (measured <= target.aimBytes) { best = { path: tmp, bytes: measured }; break; }
    if (!best || measured < best.bytes) best = { path: tmp, bytes: measured };

    const ratio = measured / target.aimBytes;
    if (bitrateBps) {
      if (resIdx < ladder.length - 1) { resIdx += 1; bitrateBps = null; crf = k.crfStart; }
      else break;
      continue;
    }
    if (crf < k.maxCrf) {
      // 体积对 CRF 近似指数关系，所以按超出倍数取 log2 推下一档，通常 2–3 档就收敛
      const jump = Math.max(k.crfStep, Math.min(8, Math.ceil(6 * Math.log2(ratio))));
      crf = Math.min(k.maxCrf, crf + jump);
      continue;
    }
    if (resIdx < ladder.length - 1) { resIdx += 1; crf = k.crfStart + k.crfStep; continue; }
    // 分辨率和 CRF 都到底了：最后上一发按目标体积反算码率
    bitrateBps = Math.max(80_000, Math.floor(((target.aimBytes - audio.estimatedBytes) * 8 * 0.9) / Math.max(1, info.durationSec)));
  }

  if (dryRun) {
    // dry-run 只描述「打算怎么试」，没有真的压过任何东西，
    // 所以绝不能拿「没产出」去判定压不进去——那是拿没跑过的实验当结论。
    return finish({ ...base, action: 'encode', output: outPath, before: info.sizeBytes, after: null, passes, afterInfo: null, dryRun: true });
  }

  if (!best) {
    const floor = ladder[ladder.length - 1];
    throw new Error(
      `压不进去：${input}\n` +
      `  时长 ${(info.durationSec || 0).toFixed(1)}s，目标 ${target.label}，分辨率已经降到 ${floor.w}×${floor.h}、CRF 拉满 ${k.maxCrf} 仍然超限。\n` +
      `  换一条路：裁短时长（express trim）、分段发（express split），或者改成发网盘链接。`,
    );
  }

  await produce(best.path, outPath, ffmpeg, { move: true });
  cleanupTmp(outPath);
  const after = statSync(outPath).size;
  return finish({
    ...base, action: 'encode', output: outPath, before: info.sizeBytes, after,
    passes, afterInfo: await probe(outPath, { ffprobe }),
  });
}

function cleanupTmp(outPath) {
  const dir = path.dirname(outPath);
  const base = path.basename(outPath);
  let entries = [];
  try { entries = readdirSync(dir); } catch { return; }
  for (const f of entries) {
    if (/^.*\.p\d+\.tmp\.mp4$/.test(f) && f.startsWith(base.replace(/\.mp4$/, ''))) {
      try { unlinkSync(path.join(dir, f)); } catch { /* 清理失败不影响主流程 */ }
    }
  }
}

async function produce(src, dest, ffmpeg, { copy = false, move = false } = {}) {
  mkdirSync(path.dirname(dest), { recursive: true });
  if (path.resolve(src) === path.resolve(dest)) return;
  if (move) {
    copyFileSync(src, dest);
    try { unlinkSync(src); } catch { /* 已经不在就算了 */ }
    return;
  }
  if (copy) { copyFileSync(src, dest); return; }
  const { code, stderr } = await run(ffmpeg.path, ['-nostdin', '-v', 'error', '-y', '-i', src, '-c', 'copy', dest]);
  if (code !== 0) throw new Error(`封装失败：${(stderr || '').trim()}`);
}

function defaultOutPath(input, target, preset) {
  const dir = path.dirname(input);
  const base = path.basename(input, path.extname(input));
  const tag = target.kind === 'platform' ? target.platform.id : `lt${Math.max(1, Math.round(target.hardBytes / 1024 / 1024))}mb`;
  return path.join(dir, `${base}.${tag}.${preset}.mp4`);
}

function finish(o) {
  const hasAfter = o.after !== null && o.after !== undefined;
  const fits = hasAfter ? o.after <= o.target.hardBytes : null;
  const dur = o.inputInfo.durationSec || 0;
  const durationOk = o.target.maxDurationSec === null || o.target.maxDurationSec === undefined
    ? null : dur <= o.target.maxDurationSec;
  return {
    ...o,
    verdict: {
      fitsHardLimit: fits,
      fitsAim: hasAfter ? o.after <= o.target.aimBytes : null,
      durationOk,
    },
    savedBytes: hasAfter ? Math.max(0, o.before - o.after) : null,
    ratio: hasAfter && o.after > 0 ? Math.round((o.before / o.after) * 100) / 100 : null,
    alternatives: hasAfter && !fits ? suggestAlternatives(o) : [],
  };
}

/** 压不进去时，至少告诉用户「要换什么才可能行」。 */
export function suggestAlternatives(o) {
  const out = [];
  const dur = o.inputInfo.durationSec || 0;
  const k = KINDS[o.content.kind] || KINDS.camera;
  const w = Math.max(360, Math.round((o.inputInfo.video.displayWidth || 1280) * 0.25));
  const h = Math.max(360, Math.round((o.inputInfo.video.displayHeight || 720) * 0.25));
  const fps = fpsCap(o.inputInfo.video.fps, 'small') || 30;
  const bytesPerSec = estimateBytes({ width: w, height: h, fps, crf: k.maxCrf, kind: o.content.kind, durationSec: 1 });
  if (bytesPerSec > 0 && dur > 0) {
    const maxSec = Math.floor(o.target.aimBytes / bytesPerSec);
    // 只在真帮得上忙时才提：裁掉不到两成的片子等于没裁，这种建议是噪音
    if (maxSec > 0 && maxSec < dur * 0.8) {
      out.push({ kind: 'trim', text: `裁到约 ${maxSec} 秒（现在 ${Math.round(dur)} 秒）大概能压进去`, seconds: maxSec });
    }
  }
  out.push({ kind: 'split', text: `按 ${Math.max(2, Math.ceil(o.inputInfo.sizeBytes / o.target.hardBytes))} 段分开发，每段都小于上限` });
  out.push({ kind: 'link', text: '上传到网盘 / 视频平台后发链接，这类场景大多数平台都收链接不收文件' });
  return out;
}
