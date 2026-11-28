#!/usr/bin/env node
// h3-gif —— GIF 命令行工具：把组图切格拼成 GIF、把几张图拼成 GIF、把一组程序画好的帧编码成 GIF、
// 让一张图绕中心转成 GIF、检查一个 GIF
// （随包发布，零第三方依赖）。
//
// 存在的意义：生图模型一次只出一张静态图。要动起来，要么让模型一次画一张分格的组图（同一个角色、同一套画风，
// 比一帧一帧分开画一致得多），由程序切开按顺序播；要么像 jungle-adventure、david-voxel-loop 两个例子那样，
// 静态图由模型画，会动的部分由 Agent 写程序一帧一帧算出来。两种都要同一套东西：全组共用一套调色板（颜色不会一帧一跳）、
// 每帧时长可以不一样、循环首尾接得上、写完从文件读回来核对、出一张帧拼图给人看一眼。这个工具把这些做成现成的命令，
// Agent 不用每次自己写编码和核对的脚本。
//
// 用法：
//   node tools/h3-gif.mjs grid   <组图> [--rows R --cols C | --count N] [节奏参数] [-o 输出.gif] [--sheet 帧条.png]
//   node tools/h3-gif.mjs split  <组图> [--rows R --cols C | --count N] [--no-align] [-o 目录]
//   node tools/h3-gif.mjs slides <图1> <图2> ... [节奏参数] [-o 输出.gif] [--sheet 帧条.png]
//   node tools/h3-gif.mjs frames <帧1> <帧2> ... | --dir <目录>  [--frame-ms 100 | --delays 310,60,...] [--once]
//                                [--edge 长边 | --scale 倍数] [--dither none|ordered] [--colors N] [--stabilize N] [--fit]
//                                [-o 输出.gif] [--sheet 拼图.png]
//   node tools/h3-gif.mjs check  <GIF> [--frames N] [--loop | --once] [--ms 总毫秒] [--sheet 拼图.png]
//   node tools/h3-gif.mjs spin   <图片> [--center x,y] [--radius r] [--steps N | --frames N] [--ccw] [--frame-ms N]
//                                [--fade | --cut] [--no-refine] [--once] [--edge 长边] [-o 输出.gif] [--sheet 帧条.png]
//       绕圆心把图里的一块圆盘转起来（加载圈、转动的图标、齿轮）：一格一格跑的写 --steps（圆环上等距的点数），连续转写 --frames。
//
// 约定：成功时 stdout 只输出一个 JSON 对象，退出码 0。失败时 stderr 输出原因：用法、文件错误、切不出格子退出码 1；
// 写出去的 GIF 读回来核对没通过（这时不写输出文件），或者 check 的预期没对上，退出码 2。
// 永远不覆盖输入文件；不带 -o 时输出写在输入旁边，重名时加序号。
// 这是 Agent 用 node 单独运行的命令行工具，Mini App 入口（server.mjs）从不 import 它，
// 所以这里的 stdout 是这个子进程自己的，不是 Host 的。
import { readFile, writeFile, readdir, stat, mkdir, realpath } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { decodeImage } from '../lib/image.mjs';
import { encodePng } from '../lib/png.mjs';
import { gifSize } from '../lib/gif.mjs';
import { detectPanels, framePanels, renderPanel } from '../lib/panels.mjs';
import { buildPanelGif, buildSlidesGif, buildSpinGif, contactSheet, encodeFrames, inspectGif } from '../lib/gifbuild.mjs';

const USAGE = `h3-gif —— 组图拼 GIF、几张图拼成 GIF、一组帧编码成 GIF、让图绕中心转、检查 GIF

  node tools/h3-gif.mjs grid   <组图> [--rows R --cols C | --count N] [节奏参数] [-o 输出.gif] [--sheet 帧条.png]
  node tools/h3-gif.mjs split  <组图> [--rows R --cols C | --count N] [--no-align] [-o 目录]
  node tools/h3-gif.mjs slides <图1> <图2> ... [节奏参数] [-o 输出.gif] [--sheet 帧条.png]
  node tools/h3-gif.mjs frames <帧1> <帧2> ... | --dir <目录> [--frame-ms 100 | --delays 310,60,...] [--once]
                               [--edge 长边 | --scale 倍数] [--dither none|ordered] [--colors N] [--stabilize N] [--fit]
                               [-o 输出.gif] [--sheet 拼图.png]
  node tools/h3-gif.mjs check  <GIF> [--frames N] [--loop | --once] [--ms 总毫秒] [--sheet 拼图.png]
  node tools/h3-gif.mjs spin   <图片> [--center x,y] [--radius r] [--steps N | --frames N] [--ccw] [--frame-ms N]
                               [--fade | --cut] [--no-refine] [--once] [--edge 长边] [-o 输出.gif] [--sheet 帧条.png]

spin：center 是转动中心（宽、高的比例，默认 0.5,0.5），radius 是要转的圆盘半径（短边的比例，默认 0.35，会按画面里的内容自动放大）；
  --steps 12 一格一格跳（圆环上等距 12 个点，默认每格 80 毫秒、两格之间渐变），--frames 24 连续转一圈 24 帧（默认每帧 50 毫秒）。

节奏参数（grid、slides）：
  --order 1,2,3       播放顺序，写格子编号（从上到下、从左到右数）
  --frame-ms 700      每格停多久；--first-ms、--last-ms 第一格、最后一格停多久（默认 1.5 倍、2 倍）
  --hold 3:1200       第 3 格停 1200 毫秒，可以写多次
  --pingpong          来回播（1→6→2）      --once      只播一遍
  --fade              两格之间渐变过渡（默认直接切换）
  --bounce            切换时轻微弹一下（默认不弹：整幅画面会跟着放大再落回）
  --edge 768          GIF 长边（默认 768）
  --no-align          不对齐各格（grid）
`;

function parseArgs(argv) {
  const positional = [];
  const flags = { hold: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new Error(token + ' 后面缺少参数');
      i += 1;
      return argv[i];
    };
    const number = () => {
      const raw = value();
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error(token + ' 要一个数，收到：' + raw);
      return n;
    };
    if (token === '-o' || token === '--out') flags.out = value();
    else if (token === '--sheet') flags.sheet = value();
    else if (token === '--rows') flags.rows = number();
    else if (token === '--cols') flags.cols = number();
    else if (token === '--count') flags.count = number();
    else if (token === '--order') flags.order = numberList(token, value());
    else if (token === '--frame-ms') flags.frameMs = number();
    else if (token === '--first-ms') flags.firstMs = number();
    else if (token === '--last-ms') flags.lastMs = number();
    else if (token === '--hold') flags.hold.push(parseHold(value()));
    else if (token === '--pingpong') flags.pingpong = true;
    else if (token === '--once') flags.once = true;
    else if (token === '--loop') flags.loop = true;
    else if (token === '--fade') flags.fade = true;
    else if (token === '--bounce') flags.bounce = true;
    else if (token === '--no-bounce') flags.noBounce = true;
    else if (token === '--no-align') flags.noAlign = true;
    else if (token === '--edge') flags.edge = number();
    else if (token === '--scale') flags.scale = number();
    else if (token === '--dir') flags.dir = value();
    else if (token === '--delays') flags.delays = numberList(token, value());
    else if (token === '--dither') flags.dither = String(value()).toLowerCase();
    else if (token === '--colors') flags.colors = number();
    else if (token === '--stabilize') flags.stabilize = number();
    else if (token === '--fit') flags.fit = true;
    else if (token === '--center') flags.center = numberList(token, value());
    else if (token === '--radius') flags.radius = number();
    else if (token === '--steps') flags.steps = number();
    else if (token === '--ccw') flags.ccw = true;
    else if (token === '--cut') flags.cut = true;
    else if (token === '--no-refine') flags.noRefine = true;
    else if (token === '--frames') flags.frames = number();
    else if (token === '--ms') flags.ms = number();
    else if (token === '-h' || token === '--help') flags.help = true;
    else if (token.startsWith('-')) throw new Error('不认识的参数：' + token + '\n\n' + USAGE);
    else positional.push(token);
  }
  return { positional, flags };
}

function numberList(token, raw) {
  const list = String(raw).split(/[,，\s]+/).filter(Boolean).map(Number);
  if (!list.length || list.some((n) => !Number.isFinite(n))) throw new Error(token + ' 要用逗号隔开的数，收到：' + raw);
  return list;
}

function parseHold(raw) {
  const match = /^(\d+)[:：](\d+)$/.exec(String(raw).trim());
  if (!match) throw new Error('--hold 的写法是 格子编号:毫秒，例如 --hold 6:1500，收到：' + raw);
  return { index: Number(match[1]), ms: Number(match[2]) };
}

async function ensureReadable(path) {
  const info = await stat(path).catch(() => null);
  if (!info || !info.isFile()) throw new Error('文件不存在或不是普通文件：' + path);
  return path;
}

async function loadImage(path) {
  const buffer = await readFile(await ensureReadable(path));
  try {
    return decodeImage(buffer);
  } catch (error) {
    throw new Error('解不开这张图（只认 PNG、JPEG、GIF 的第一帧）：' + path + '（' + (error && error.message ? error.message : error) + '）');
  }
}

// 不覆盖已有文件：默认路径重名时加 -2、-3……
async function freePath(path) {
  const ext = extname(path);
  const stem = path.slice(0, path.length - ext.length);
  for (let n = 1; n < 1000; n += 1) {
    const candidate = n === 1 ? path : stem + '-' + n + ext;
    const exists = await stat(candidate).then(() => true, () => false);
    if (!exists) return candidate;
  }
  throw new Error('找不到可用的输出文件名：' + path);
}

async function outputPath(flags, inputs, fallback) {
  if (flags.out) {
    const out = resolve(flags.out);
    const real = await realPathOf(out);
    for (const input of inputs) if ((await realPathOf(input)) === real) throw new Error('输出路径不能和输入文件相同：不覆盖输入');
    return out;
  }
  return freePath(fallback);
}

// 按真实路径比：macOS 上 /var 是 /private/var 的软链接，同一个文件两种写法的字符串不相等，
// 只比字符串会把输入图当成别的文件覆盖掉。输出文件还不存在时，取它所在目录的真实路径。
async function realPathOf(path) {
  try {
    return await realpath(path);
  } catch {
    try {
      return join(await realpath(dirname(path)), basename(path));
    } catch {
      return path;
    }
  }
}

function sheetPathFor(flags, gifPath) {
  return flags.sheet ? resolve(flags.sheet) : gifPath.replace(/\.gif$/i, '') + '-frames.png';
}

// 节奏参数 → panelTimeline / buildPanelGif 认的 spec。
function rhythmSpec(flags) {
  return {
    rows: flags.rows,
    cols: flags.cols,
    count: flags.count,
    order: flags.order || [],
    frameMs: flags.frameMs,
    firstMs: flags.firstMs,
    lastMs: flags.lastMs,
    hold: flags.hold,
    loop: !flags.once,
    pingpong: Boolean(flags.pingpong),
    transition: flags.fade ? 'fade' : 'cut',
    // 默认不弹；--no-bounce 是以前的写法，照样认。
    bounce: Boolean(flags.bounce) && !flags.noBounce,
    edge: flags.edge,
    align: !flags.noAlign,
  };
}

function gridSummary(detection) {
  return {
    rows: detection.rows,
    cols: detection.cols,
    count: detection.count,
    method: detection.method,
    strength: detection.strength,
    panels: detection.cells.map((cell) => ({ index: cell.index, row: cell.row, col: cell.col, x: cell.x, y: cell.y, w: cell.w, h: cell.h })),
  };
}

function timelineSummary(timeline) {
  return {
    order: timeline.order,
    holds: timeline.holds,
    transition: timeline.transition,
    bounce: timeline.bounce,
    loop: timeline.loop,
    durationMs: timeline.durationMs,
  };
}

async function writeVerified(built, out, sheet) {
  if (!built.verify.ok) {
    process.stderr.write('GIF 读回来核对没通过，没有写输出文件：' + built.verify.problems.join('；') + '\n' + JSON.stringify({ ok: false, verify: built.verify }) + '\n');
    return false;
  }
  await writeFile(out, built.gif.buffer);
  await writeFile(sheet, encodePng(built.strip, { level: 6 }));
  return true;
}

function notGrid(input) {
  return new Error(
    '没在图里找到格子之间的分隔线或留白，切不出两格以上：' + input +
      '。确定是组图的话，用 --rows / --cols（或 --count）说明几行几列，按等分切；不是组图就用 frames 自己出帧',
  );
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  if (!command || flags.help || command === '-h' || command === '--help' || command === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }

  if (command === 'grid') {
    if (positional.length !== 1) throw new Error('grid 需要且只需要 1 张组图');
    const input = resolve(positional[0]);
    const image = await loadImage(input);
    let built;
    try {
      built = buildPanelGif(image, rhythmSpec(flags));
    } catch (error) {
      if (error && error.message === 'not_grid') throw notGrid(input);
      if (error && error.message === 'panel_order_too_short') throw new Error('--order 留下的格子不到 2 格');
      throw error;
    }
    const out = await outputPath(flags, [input], join(dirname(input), basename(input, extname(input)) + '.gif'));
    const sheet = sheetPathFor(flags, out);
    if (!(await writeVerified(built, out, sheet))) return 2;
    return emit({
      ok: true,
      out,
      sheet,
      width: built.size.width,
      height: built.size.height,
      bytes: built.gif.buffer.length,
      frames: built.gif.frameCount,
      durationMs: built.verify.durationMs,
      loop: built.verify.loop,
      grid: gridSummary(built.detection),
      framing: { mode: built.framing.mode, width: built.framing.width, height: built.framing.height, offsets: built.framing.frames.map((frame, i) => ({ index: i + 1, dx: frame.dx, dy: frame.dy })) },
      timeline: timelineSummary(built.timeline),
      verify: built.verify,
    });
  }

  if (command === 'split') {
    if (positional.length !== 1) throw new Error('split 需要且只需要 1 张组图');
    const input = resolve(positional[0]);
    const image = await loadImage(input);
    const detection = detectPanels(image, { rows: flags.rows, cols: flags.cols, count: flags.count });
    if (detection.count < 2) throw notGrid(input);
    const framing = framePanels(image, detection.cells, { align: !flags.noAlign });
    let dir = flags.out ? resolve(flags.out) : join(dirname(input), basename(input, extname(input)) + '-panels');
    if (!flags.out) {
      for (let n = 2; await stat(dir).then(() => true, () => false); n += 1) dir = join(dirname(input), basename(input, extname(input)) + '-panels-' + n);
    }
    await mkdir(dir, { recursive: true });
    const files = [];
    for (let i = 0; i < framing.frames.length; i += 1) {
      const frame = framing.frames[i];
      const tile = renderPanel(image, frame, framing.width, framing.height, { mode: framing.mode });
      const file = join(dir, String(i + 1).padStart(2, '0') + '.png');
      if (await stat(file).then(() => true, () => false)) throw new Error('目录里已经有 ' + basename(file) + '，不覆盖：' + dir);
      await writeFile(file, encodePng(tile, { level: 6 }));
      const cell = detection.cells[i];
      files.push({ index: i + 1, row: cell.row, col: cell.col, file, crop: { x: frame.x, y: frame.y, w: frame.w, h: frame.h }, dx: frame.dx, dy: frame.dy });
    }
    return emit({ ok: true, dir, width: framing.width, height: framing.height, mode: framing.mode, grid: gridSummary(detection), files });
  }

  if (command === 'slides') {
    if (positional.length < 2) throw new Error('slides 至少要 2 张图');
    const inputs = positional.map((item) => resolve(item));
    const images = [];
    for (const input of inputs) images.push(await loadImage(input));
    let built;
    try {
      built = buildSlidesGif(images, rhythmSpec(flags));
    } catch (error) {
      if (error && error.message === 'panel_order_too_short') throw new Error('--order 留下的图不到 2 张');
      throw error;
    }
    const out = await outputPath(flags, inputs, join(dirname(inputs[0]), basename(inputs[0], extname(inputs[0])) + '-slides.gif'));
    const sheet = sheetPathFor(flags, out);
    if (!(await writeVerified(built, out, sheet))) return 2;
    return emit({
      ok: true,
      out,
      sheet,
      width: built.size.width,
      height: built.size.height,
      bytes: built.gif.buffer.length,
      frames: built.gif.frameCount,
      durationMs: built.verify.durationMs,
      loop: built.verify.loop,
      mode: built.framing.mode,
      sources: inputs.map((file, i) => ({ index: i + 1, file })),
      timeline: timelineSummary(built.timeline),
      verify: built.verify,
    });
  }

  if (command === 'frames') {
    const inputs = flags.dir ? await listFrames(resolve(flags.dir)) : positional.map((item) => resolve(item));
    if (flags.dir && positional.length) throw new Error('frames 用了 --dir 就不要再列帧文件');
    if (inputs.length < 2) throw new Error('frames 至少要 2 帧');
    const images = [];
    for (const input of inputs) images.push(await loadImage(input));
    const first = images[0];
    const odd = images.findIndex((image) => image.width !== first.width || image.height !== first.height);
    if (odd >= 0 && !flags.fit) {
      throw new Error('第 ' + (odd + 1) + ' 帧是 ' + images[odd].width + '×' + images[odd].height + '，和第 1 帧的 ' + first.width + '×' + first.height + ' 不一样。各帧要一样大；要统一成第 1 帧的画幅就加 --fit');
    }
    let delays;
    if (flags.delays) {
      if (flags.delays.length !== images.length) throw new Error('--delays 写了 ' + flags.delays.length + ' 个数，帧有 ' + images.length + ' 帧，要一样多');
      delays = flags.delays.map((ms) => Math.max(20, Math.min(10000, Math.round(ms))));
    } else {
      const each = Number.isFinite(flags.frameMs) ? Math.max(20, Math.min(10000, Math.round(flags.frameMs))) : 100;
      delays = images.map(() => each);
    }
    if (flags.dither && !['none', 'ordered'].includes(flags.dither)) throw new Error('--dither 只能是 none 或 ordered');
    let size;
    if (Number.isFinite(flags.scale)) {
      const k = Math.round(flags.scale);
      if (k < 1 || k > 8) throw new Error('--scale 要 1 到 8 的整数');
      size = { width: first.width * k, height: first.height * k };
    } else {
      size = gifSize(first.width, first.height, Number.isFinite(flags.edge) ? Math.max(16, Math.min(2048, Math.round(flags.edge))) : 1024);
    }
    const encoded = encodeFrames(images, {
      width: size.width,
      height: size.height,
      delays,
      loop: !flags.once,
      // 程序画的帧默认逐像素写进去：差一两级的变化（扫描线的余辉、渐隐）也是动画的一部分。
      stabilize: Number.isFinite(flags.stabilize) ? Math.max(0, Math.min(40, flags.stabilize)) : 0,
      dither: flags.dither,
      colors: flags.colors,
    });
    const info = inspectGif(encoded.gif.buffer);
    // 默认写在帧所在目录的旁边：写进帧目录里，下次 --dir 会把它当成一帧。
    const out = await outputPath(flags, inputs, join(dirname(dirname(inputs[0])), basename(dirname(inputs[0])) + '.gif'));
    const sheet = sheetPathFor(flags, out);
    const built = { gif: encoded.gif, verify: encoded.verify, strip: framesSheet(info.images) };
    if (!(await writeVerified(built, out, sheet))) return 2;
    return emit({
      ok: true,
      out,
      sheet,
      width: size.width,
      height: size.height,
      bytes: encoded.gif.buffer.length,
      input: inputs.length,
      frames: encoded.gif.frameCount,
      delays: info.delays,
      durationMs: info.durationMs,
      loop: info.loop === 0,
      colors: encoded.gif.colors,
      dither: encoded.gif.dither,
      seam: info.seam,
      notes: frameNotes(encoded.gif, info, delays),
      verify: encoded.verify,
    });
  }

  if (command === 'spin') {
    if (positional.length !== 1) throw new Error('spin 需要且只需要 1 张图');
    if (flags.center && flags.center.length !== 2) throw new Error('--center 要写两个数：x,y（画面宽、高的比例）');
    if (flags.fade && flags.cut) throw new Error('--fade 和 --cut 只能写一个');
    const input = resolve(positional[0]);
    const image = await loadImage(input);
    const built = buildSpinGif(image, {
      spin: {
        center: flags.center,
        radius: flags.radius,
        steps: flags.steps,
        frames: flags.steps ? undefined : flags.frames,
        direction: flags.ccw ? 'ccw' : 'cw',
        refine: !flags.noRefine,
      },
      frameMs: flags.frameMs,
      loop: !flags.once,
      transition: flags.fade ? 'fade' : flags.cut ? 'cut' : '',
      edge: flags.edge,
    });
    const out = await outputPath(flags, [input], join(dirname(input), basename(input, extname(input)) + '-spin.gif'));
    const sheet = sheetPathFor(flags, out);
    if (!(await writeVerified(built, out, sheet))) return 2;
    const short = Math.min(image.width, image.height);
    return emit({
      ok: true,
      out,
      sheet,
      width: built.size.width,
      height: built.size.height,
      bytes: built.gif.buffer.length,
      frames: built.count,
      written: built.gif.frameCount,
      durationMs: built.verify.durationMs,
      loop: built.verify.loop,
      steps: built.spin.steps,
      direction: built.spin.direction,
      transition: built.fade ? 'fade' : 'cut',
      frameMs: built.frameMs,
      // 程序最后用的圆心（画面比例）、转的半径（短边比例）；moved 是比给的圆心挪了多少（短边比例）
      center: [Math.round((built.where.cx / image.width) * 1000) / 1000, Math.round((built.where.cy / image.height) * 1000) / 1000],
      radius: Math.round((built.where.radius / short) * 1000) / 1000,
      moved: Math.round((built.where.refined.moved / short) * 1000) / 1000,
      verify: built.verify,
    });
  }

  if (command === 'check') {
    if (positional.length !== 1) throw new Error('check 需要且只需要 1 个 GIF');
    const input = resolve(positional[0]);
    const buffer = await readFile(await ensureReadable(input));
    let info;
    try {
      info = inspectGif(buffer);
    } catch (error) {
      throw new Error('不是能读的 GIF：' + input + '（' + (error && error.message ? error.message : error) + '）');
    }
    const problems = [];
    if (Number.isFinite(flags.frames) && info.frames !== Math.round(flags.frames)) problems.push('帧数 ' + info.frames + '，应为 ' + Math.round(flags.frames));
    if (flags.loop && info.loop !== 0) problems.push('没有无限循环');
    if (flags.once && info.loop !== null) problems.push('写了循环播放');
    if (Number.isFinite(flags.ms) && Math.abs(info.durationMs - flags.ms) > 10 * info.frames) problems.push('整组 ' + info.durationMs + ' 毫秒，应为 ' + Math.round(flags.ms));
    let sheet = null;
    if (flags.sheet) {
      sheet = resolve(flags.sheet);
      if ((await realPathOf(sheet)) === (await realPathOf(input))) throw new Error('--sheet 不能和输入相同');
      await writeFile(sheet, encodePng(framesSheet(info.images), { level: 6 }));
    }
    const payload = {
      ok: problems.length === 0,
      width: info.width,
      height: info.height,
      bytes: buffer.length,
      frames: info.frames,
      delays: info.delays,
      durationMs: info.durationMs,
      loop: info.loop === 0 ? 'forever' : info.loop === null ? 'once' : info.loop,
      steps: info.steps,
      seam: info.seam,
      notes: frameNotes(null, info, null),
      problems,
      sheet,
    };
    if (problems.length) {
      process.stderr.write('GIF 和预期不一样：' + problems.join('；') + '\n' + JSON.stringify(payload) + '\n');
      return 2;
    }
    return emit(payload);
  }

  throw new Error('未知子命令：' + command + '\n\n' + USAGE);
}

// --dir 里的帧：PNG、JPEG，按文件名里的数字自然排序（frame-2 在 frame-10 前面）。不收 GIF：多半是上一次的输出。
async function listFrames(dir) {
  const info = await stat(dir).catch(() => null);
  if (!info || !info.isDirectory()) throw new Error('不是目录：' + dir);
  const names = (await readdir(dir)).filter((name) => /\.(png|jpe?g)$/i.test(name) && !name.startsWith('.'));
  names.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  return names.map((name) => join(dir, name));
}

// 帧拼图：一行最多 4 张（16 帧就是 4×4，和两个例子的 spritesheet、check.jpg 一样），每张标帧号。
function framesSheet(images) {
  const perRow = Math.min(4, images.length);
  return contactSheet(images.map((image, i) => ({ image, label: String(i + 1) })), { perRow, width: Math.min(2048, perRow * 256), fill: 246 });
}

function frameNotes(gif, info, delays) {
  const notes = [];
  if (gif && gif.frameCount < gif.changed.length) {
    notes.push('有 ' + (gif.changed.length - gif.frameCount) + ' 帧和前一帧一模一样，并进了前一帧的时长');
  }
  if (delays && delays.some((ms) => ms % 10)) notes.push('GIF 的时长以 10 毫秒为单位，不是 10 的倍数的已按四舍五入写入（见 delays）');
  if (info.seam && info.seam.identicalEnds) notes.push('首尾两帧完全一样：循环接缝处这一画面会连着停两帧的时长');
  else if (info.seam && info.seam.jump) notes.push('循环接缝处会跳一下：最后一帧接回第一帧的变化比中间最大的一步还大不少；要无缝循环，最后一帧应该是第一帧的前一步');
  return notes;
}

function emit(payload) {
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    process.stderr.write(String(error && error.message ? error.message : error) + '\n');
    process.exit(1);
  });
