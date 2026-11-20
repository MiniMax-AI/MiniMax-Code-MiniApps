#!/usr/bin/env node
// h3-qr —— 二维码命令行工具：生成真码、扫码、找图里的码、把图里的假码换成真码（随包发布，零第三方依赖，
// 解码器用同包 vendor/jsqr 里的 jsQR，Apache-2.0）。
//
// 存在的意义：生图模型画不出能扫的二维码。面板流水线会自动修码；这个工具给聊天里用——
// 任何一张已有的图（不管是不是这个插件画的），都能在不重新生图的前提下把码换成真码，并扫码验证。
//
// 用法：
//   node tools/h3-qr.mjs fix <图片> --content <内容> [--content <第二枚码的内容>] [-o 输出]
//   node tools/h3-qr.mjs fix <图片> --content-file <文本文件> [-o 输出]
//       找到图里的二维码，换成内容为 <内容> 的真码（跟随原来的透视和明暗），再从输出文件扫码验证。
//       多枚码时 --content 按图里从上到下、从左到右的顺序给。只有一条内容时换图里最大的那枚。
//       不带 -o 时写在输入图旁边：<原名>-qr.<扩展名>，重名时加序号。永远不覆盖输入图。
//   node tools/h3-qr.mjs scan <图片>
//       扫出图里所有能扫的码（内容、版本、四角坐标）。
//   node tools/h3-qr.mjs locate <图片>
//       找出图里所有二维码的位置，包括扫不出的假码（四角、模块数估计、四周留白）。
//   node tools/h3-qr.mjs make --content <内容> [-o 输出.png] [--ecl L|M|Q|H] [--module 像素] [--quiet 模块数]
//       单独生成一张二维码 PNG，并扫一遍确认能扫。不带 -o 时写在当前工作目录的 qr.png（重名加序号）。
//
// 约定：成功时 stdout 只输出一个 JSON 对象，退出码 0。
// 失败时 stderr 输出原因：用法或文件错误退出码 1；fix 换码后验证不通过退出码 2，不写输出文件。
// 这是 Agent 用 node 单独运行的命令行工具，Mini App 入口（server.mjs）从不 import 它，
// 所以这里的 stdout 是这个子进程自己的，不是 Host 的。
import { readFile, writeFile, stat, realpath } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { encodeQr, renderQr, ECL_LEVELS } from '../lib/qrcode.mjs';
import { scanQr, scanAllQr } from '../lib/qrscan.mjs';
import { locateQrCodes, fixQrInBuffer } from '../lib/qrfix.mjs';
import { decodeImage } from '../lib/image.mjs';
import { encodePng } from '../lib/png.mjs';

const USAGE = `h3-qr —— 二维码工具：生成、扫码、定位、把图里的假码换成真码

  node tools/h3-qr.mjs fix    <图片> --content <内容> [--content <内容>...] [-o 输出]
  node tools/h3-qr.mjs fix    <图片> --content-file <文本文件> [-o 输出]
  node tools/h3-qr.mjs scan   <图片>
  node tools/h3-qr.mjs locate <图片>
  node tools/h3-qr.mjs make   --content <内容> [-o 输出.png] [--ecl L|M|Q|H] [--module 像素] [--quiet 模块数]
`;

function parseArgs(argv) {
  const positional = [];
  const flags = { contents: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new Error(token + ' 后面缺少参数');
      i += 1;
      return argv[i];
    };
    if (token === '-o' || token === '--out') flags.out = value();
    else if (token === '--content') flags.contents.push({ text: value() });
    else if (token === '--content-file') flags.contents.push({ file: value() });
    else if (token === '--ecl') flags.ecl = String(value()).toUpperCase();
    else if (token === '--module') flags.module = Number(value());
    else if (token === '--quiet') flags.quiet = Number(value());
    else if (token === '-h' || token === '--help') flags.help = true;
    else positional.push(token);
  }
  return { positional, flags };
}

async function ensureReadable(path) {
  const info = await stat(path).catch(() => null);
  if (!info || !info.isFile()) throw new Error('文件不存在或不是普通文件：' + path);
  return path;
}

// --content-file 读 UTF-8 全文，只去掉末尾一个换行（编辑器保存时常带）；内容中间一个字符都不动。
async function readContents(list) {
  const out = [];
  for (const item of list) {
    const text = item.file ? (await readFile(resolve(item.file), 'utf8')).replace(/\r?\n$/, '') : item.text;
    if (!text) throw new Error('二维码内容不能为空');
    out.push(text);
  }
  return out;
}

// 按真实路径比：macOS 上 /var 是 /private/var 的软链接，同一个文件两种写法的字符串不相等，
// 只比字符串会把原图当成别的文件覆盖掉。输出文件还不存在时，取它所在目录的真实路径。
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

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  if (!command || flags.help || command === '-h' || command === '--help' || command === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }

  if (command === 'fix') {
    if (positional.length !== 1) throw new Error('fix 需要且只需要 1 个图片参数');
    if (!flags.contents.length) throw new Error('fix 需要 --content <内容> 或 --content-file <文件>');
    const input = await ensureReadable(resolve(positional[0]));
    const contents = await readContents(flags.contents);
    const buffer = await readFile(input);
    const result = await fixQrInBuffer(buffer, contents);
    const items = result.results.map((item) => ({
      content: item.content,
      ok: item.ok,
      changed: item.changed,
      reason: item.reasonText || '',
      detail: item.detail || '',
      version: item.version,
      ecl: item.ecl,
      modules: item.modules,
      modulePx: item.modulePx,
      corners: item.corners,
      scans: (item.scans || []).map((scan) => ({ view: scan.view, pad: scan.pad, ok: scan.data === item.content })),
    }));
    if (!result.ok) {
      const why = items.filter((item) => !item.ok).map((item) => '「' + item.content + '」' + item.reason + (item.detail ? '（' + item.detail + '）' : ''));
      process.stderr.write('二维码没换成，没有写输出文件：' + why.join('；') + '\n' + JSON.stringify({ ok: false, results: items }) + '\n');
      return 2;
    }
    const ext = result.format === 'png' ? '.png' : '.jpg';
    let out;
    if (flags.out) {
      out = resolve(flags.out);
      if ((await realPathOf(out)) === (await realPathOf(input))) throw new Error('输出路径不能和输入图相同：不覆盖原图');
    } else {
      out = await freePath(join(dirname(input), basename(input, extname(input)) + '-qr' + ext));
    }
    await writeFile(out, result.buffer);
    return emit({ ok: true, out, changed: result.changed, format: result.format, results: items });
  }

  if (command === 'scan') {
    if (positional.length !== 1) throw new Error('scan 需要且只需要 1 个图片参数');
    const image = decodeImage(await readFile(await ensureReadable(resolve(positional[0]))));
    const maxEdge = Math.max(image.width, image.height) > 2048 ? 2048 : undefined;
    const codes = scanAllQr(image, { max: 8, maxEdge, invert: false }).map((hit) => ({
      data: hit.data,
      version: hit.version,
      corners: hit.corners.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
    }));
    return emit({ width: image.width, height: image.height, count: codes.length, codes });
  }

  if (command === 'locate') {
    if (positional.length !== 1) throw new Error('locate 需要且只需要 1 个图片参数');
    const image = decodeImage(await readFile(await ensureReadable(resolve(positional[0]))));
    const regions = locateQrCodes(image, { max: 8 }).map((region) => ({
      scannable: region.decoded !== null,
      data: region.decoded,
      source: region.source,
      modules: Math.round(region.modules * 10) / 10,
      modulePx: Math.round(region.modulePx * 10) / 10,
      corners: region.corners.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
      quietModules: region.quiet ? region.quiet.min : 0,
    }));
    return emit({ width: image.width, height: image.height, count: regions.length, regions });
  }

  if (command === 'make') {
    const contents = await readContents(flags.contents);
    if (contents.length !== 1) throw new Error('make 需要且只需要 1 条 --content');
    if (flags.ecl && !ECL_LEVELS.includes(flags.ecl)) throw new Error('--ecl 只能是 L / M / Q / H');
    const qr = encodeQr(contents[0], { ecl: flags.ecl || 'M' });
    const modulePx = Number.isFinite(flags.module) ? Math.max(1, Math.min(64, Math.round(flags.module))) : 10;
    const quiet = Number.isFinite(flags.quiet) ? Math.max(0, Math.min(16, Math.round(flags.quiet))) : 4;
    const image = renderQr(qr, { modulePx, quiet });
    // 生成完自己扫一遍：工具说「能扫」必须是扫出来的，不是编码器自认的。
    const hit = scanQr(image);
    if (!hit || hit.data !== contents[0]) throw new Error('生成的码扫码验证没通过：' + (hit ? '扫出了别的内容' : '扫不出'));
    const out = flags.out ? resolve(flags.out) : await freePath(join(process.cwd(), 'qr.png'));
    await writeFile(out, encodePng(image, { level: 9 }));
    return emit({ ok: true, out, width: image.width, height: image.height, version: qr.version, ecl: qr.ecl, mask: qr.mask, mode: qr.mode, modules: qr.size, scanned: hit.data });
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
