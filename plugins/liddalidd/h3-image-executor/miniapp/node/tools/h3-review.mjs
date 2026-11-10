#!/usr/bin/env node
// h3-review —— H3-Image-Executor 的"看图材料 / 程序测量"命令行工具（随包发布，零第三方依赖）。
//
// 存在的意义：评审 agent 不需要每次现写裁图、拼图、量像素的脚本。
// 所有材料由 harness 按固定版式生成，评审只要 read 一张图就能看全。
//
// 用法：
//   node tools/h3-review.mjs sheet <图片> [-o 输出.png]
//       生成候选看图材料：整体 / 暗部提亮 + 亮部压暗 / 四象限局部放大，共 7 块带编号。
//   node tools/h3-review.mjs refs <图片...> [-o 输出.png] [--per-row N]
//       把多张参考图拼成一张带编号的对比图，用于真人 / 车型 / logo 一致性核对。
//   node tools/h3-review.mjs grid <图片...> [-o 输出.png] [--per-row N]
//       并排对比多张候选，用于选优。
//   node tools/h3-review.mjs stats <图片>
//       输出尺寸、色彩统计、色偏判定、亮度直方图（JSON）。
//   node tools/h3-review.mjs compare <图片> <父图>
//       输出相对父图的色彩漂移、锐度变化、平均像素差（JSON）。
//
// 评审规范与判定规则见同包文档：<插件根>/skills/h3-image-review/SKILL.md
//
// 约定：成功时 stdout 只输出一个 JSON 对象；失败时 stderr 输出原因并以非 0 退出。
// 这是 Agent 用 node 单独运行的命令行工具，Mini App 入口（server.mjs）从不 import 它，
// 所以这里的 stdout 是这个子进程自己的，不是 Host 的。
// 不带 -o 时：sheet 写在输入图旁边，refs / grid 写在当前工作目录。
import { stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { buildCandidateSheet, buildGridSheet, imageStats, compareImages } from '../lib/review.mjs';

const USAGE = `h3-review —— 看图材料与程序测量工具

  node tools/h3-review.mjs sheet <图片> [-o 输出.png]
  node tools/h3-review.mjs refs  <图片...> [-o 输出.png] [--per-row N]
  node tools/h3-review.mjs grid  <图片...> [-o 输出.png] [--per-row N]
  node tools/h3-review.mjs stats <图片>
  node tools/h3-review.mjs compare <图片> <父图>
`;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '-o' || token === '--out') {
      flags.out = argv[++i];
    } else if (token === '--per-row') {
      flags.perRow = Math.max(1, Number(argv[++i]) || 4);
    } else if (token === '-h' || token === '--help') {
      flags.help = true;
    } else {
      positional.push(token);
    }
  }
  return { positional, flags };
}

async function ensureReadable(path) {
  const info = await stat(path).catch(() => null);
  if (!info || !info.isFile()) throw new Error('文件不存在或不是普通文件：' + path);
  return path;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  if (!command || flags.help || command === '-h' || command === '--help' || command === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }

  if (command === 'sheet') {
    if (positional.length !== 1) throw new Error('sheet 需要且只需要 1 个图片参数');
    const input = await ensureReadable(resolve(positional[0]));
    const out = resolve(flags.out || join(dirname(input), 'review-sheet.png'));
    return emit(await buildCandidateSheet(input, out));
  }

  if (command === 'refs' || command === 'grid') {
    if (!positional.length) throw new Error(command + ' 至少需要 1 个图片参数');
    const inputs = [];
    for (const item of positional) inputs.push(await ensureReadable(resolve(item)));
    // 不带 -o 时写到当前工作目录。以前默认写到插件根目录，那是 Host 安装的包目录，不该往里写东西。
    const out = resolve(flags.out || join(process.cwd(), command + '-sheet.png'));
    const items = inputs.map((path, index) => ({ path, label: command === 'refs' ? 'R' + (index + 1) : String(index + 1) }));
    return emit(await buildGridSheet(items, out, { perRow: flags.perRow || 4 }));
  }

  if (command === 'stats') {
    if (positional.length !== 1) throw new Error('stats 需要且只需要 1 个图片参数');
    return emit(await imageStats(await ensureReadable(resolve(positional[0]))));
  }

  if (command === 'compare') {
    if (positional.length !== 2) throw new Error('compare 需要 2 个图片参数：<图片> <父图>');
    return emit(
      await compareImages(
        await ensureReadable(resolve(positional[0])),
        await ensureReadable(resolve(positional[1])),
      ),
    );
  }

  throw new Error('未知子命令：' + command + '\n\n' + USAGE);
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
