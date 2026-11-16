// 命令行入口。中文界面，零第三方依赖。
import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveBinaries } from './ffmpeg.js';
import { probe } from './probe.js';
import { loadPlatforms, resolveTarget, formatBytes, formatDuration, formatBitrate, displayWidth, padDisplay, containerLabel } from './format.js';
import { fit, estimateRange } from './fit.js';
import { toGif } from './gif.js';
import { trim } from './trim.js';
import { split } from './split.js';
import { cardHtml, extractPoster } from './card.js';
import { doctor, formatDoctor } from './doctor.js';
import { analyzeContent } from './classify.js';
import { appendEntry, readEntries, summarize, writeReport, toEntry, ledgerPath } from './ledger.js';

const C = (() => {
  const on = process.stdout.isTTY && !process.env.NO_COLOR;
  const w = (code) => (s) => (on ? `\u001b[${code}m${s}\u001b[0m` : String(s));
  return { dim: w('2'), bold: w('1'), green: w('32'), red: w('31'), yellow: w('33'), blue: w('36') };
})();

const HELP = `${C.bold('急件 express')} — 视频太大发不出去？按平台限制压好、封好、发出去。
${C.dim('全部在本机跑，文件不上传任何服务器。')}

${C.bold('用法')}
  express doctor                          体检 ffmpeg 环境（先跑这个）
  express platforms                       列出各平台的限制、来源与置信度
  express inspect <文件...> [--json]       体检：多大、多长、各平台能不能收
  express fit <文件> --to <目标>           压到能发（实测收敛，压完一定量）
  express trim <文件> --start 0:10 --end 1:20   裁一段
  express split <文件> --to <目标>              一个文件太大，切成几段都发得出去
  express gif <文件> [--width 320]         转 GIF / 表情包
  express card <文件> [--from 原始文件]    生成投递卡 HTML
  express ledger [--out 报告.html]        压缩台账与节省报告

${C.bold('fit 的常用参数')}
  --to <目标>       平台 id（wechat-chat / telegram-bot / discord-free …）或自定义大小（25MB / 500k）
  --preset <档位>   keep 保画质 | balanced 默认 | small 再小一档        （默认 balanced）
  --out <路径>      输出文件（默认在原文件旁边加后缀）
  --speed <档位>    ultrafast…veryslow，默认 medium
  --max-passes <n>  最多试几档，默认 4
  --dry-run         只出计划不真压
  --normalize       体积已达标也重编码一遍（把方向烤进像素、统一容器）
  --card            压完顺手生成投递卡
  --no-ledger       不记台账

${C.bold('例子')}
  express inspect 录屏.mp4
  express fit 录屏.mp4 --to wechat-chat
  express fit 发布会.mp4 --to 50MB --preset small --card
  express gif 精彩瞬间.mp4 --start 12 --duration 3 --width 320 --square
`;

function out(s = '') { process.stdout.write(s + '\n'); }

async function binariesOrDie() {
  const b = await resolveBinaries();
  if (!b.ffmpeg || !b.ffprobe) {
    out(C.red('✘ 找不到能用的 ffmpeg/ffprobe。'));
    const broken = (b.rejected || []).filter((x) => x.reason === 'enoent');
    if (broken.length) {
      out(C.yellow(`  有 ${broken.length} 个候选路径能解析但执行失败（常见于 winget 升级后 WinGet\\Links 里的悬空链接）：`));
      for (const x of broken.slice(0, 3)) out(C.dim(`    ${x.path}  ← ${x.from}`));
    }
    out(C.dim('  跑 express doctor 看详细诊断，或装一个：winget install ffmpeg'));
    process.exit(2);
  }
  return b;
}

function progressReporter(label) {
  if (!process.stdout.isTTY) return () => {};
  let last = -1;
  return ({ ratio }) => {
    if (ratio === null) return;
    const pct = Math.round(ratio * 100);
    if (pct === last) return;
    last = pct;
    process.stdout.write(`\r  ${label} ${String(pct).padStart(3)}%`);
  };
}

// —— inspect ——

function platformChecks(info) {
  const db = loadPlatforms();
  return db.targets.map((t) => {
    const sizeOk = info.sizeBytes <= t.maxBytes;
    const durOk = t.maxDurationSec === null || t.maxDurationSec === undefined
      ? null : (info.durationSec || 0) <= t.maxDurationSec;
    let fits;
    if (durOk === false) fits = false;
    else fits = sizeOk;
    const notes = [];
    if (!sizeOk) notes.push(`超出 ${formatBytes(info.sizeBytes - t.maxBytes)}`);
    if (durOk === false) notes.push(`时长超过 ${formatDuration(t.maxDurationSec)}`);
    return {
      id: t.id, label: t.label, maxBytes: t.maxBytes,
      maxDurationSec: t.maxDurationSec ?? null,
      confidence: t.confidence, bytes: info.sizeBytes,
      sizeOk, durationOk: durOk, fits, note: notes.join('，'),
    };
  });
}

function printInspect(info, checks) {
  const v = info.video;
  out();
  out(`${C.bold(path.basename(info.file))}`);
  out(`  体积    ${C.bold(formatBytes(info.sizeBytes))}    时长 ${formatDuration(info.durationSec)}    容器 ${containerLabel(info.format.name)}`);
  if (v.present) {
    out(`  画面    ${v.displayWidth}×${v.displayHeight}  ${v.fps ? v.fps.toFixed(2) + ' fps' : ''}  ${v.codec}${v.rotation ? `  ${C.yellow('旋转 ' + v.rotation + '°')}` : ''}${v.hdr ? C.yellow('  HDR') : ''}`);
    out(`  码率    ${formatBitrate(info.video.bitrateBps ?? info.bitrateBps)}`);
  }
  if (info.audio.present) {
    out(`  音频    ${info.audio.codec}  ${info.audio.channels}ch  ${info.audio.sampleRate}Hz  ${formatBitrate(info.audio.bitrateBps)}`);
  } else {
    out(`  音频    ${C.dim('无')}`);
  }
  out();
  out(C.bold('各平台能不能收'));
  const labelW = Math.max(...checks.map((c) => displayWidth(c.label)));
  for (const c of checks) {
    const mark = c.fits === true ? C.green('✔ 可发') : c.fits === false ? C.red('✘ 发不出去') : C.yellow('? 未知');
    const conf = c.confidence === 'official' ? C.dim('官方') : c.confidence === 'community' ? C.dim('社区实测') : C.yellow('口径不一');
    out(`  ${mark}  ${padDisplay(c.label, labelW)}  ${padDisplay('上限 ' + formatBytes(c.maxBytes), 18)} ${conf}  ${C.dim(c.note)}`);
  }
  out();
}

// —— fit ——

function printFit(r, encodeSeconds) {
  out();
  out(`${C.bold(r.action === 'copy' ? '不用压，直接发' : '压好了')}`);
  out(`  ${path.basename(r.input)}  ${formatBytes(r.before)} ${C.dim('→')} ${C.bold(formatBytes(r.after))}`);
  if (r.action === 'encode') {
    out(`  压缩比  ${r.ratio}×${r.savedBytes > 0 ? C.green(`（省下 ${formatBytes(r.savedBytes)}）`) : ''}`);
    out(`  内容判定 ${r.content.label} ${C.dim(`运动 ${r.content.metrics.motion ?? '—'} / 细节 ${r.content.metrics.detail ?? '—'}`)}`);
    out(`  耗时    ${formatDuration(encodeSeconds)}，试了 ${r.passes.length} 档`);
    for (const p of r.passes) {
      const hit = p.measuredBytes !== null && p.measuredBytes <= r.target.aimBytes;
      out(C.dim(`    ${p.width}×${p.height} ${p.fps}fps CRF${p.crf ?? '—'}${p.bitrateBps ? ' ' + formatBitrate(p.bitrateBps) : ''} → ${formatBytes(p.measuredBytes)} ${hit ? C.green('✔') : ''}`));
    }
  }
  const v = r.verdict;
  for (const w of r.warnings || []) out(C.yellow(`  ! ${w}`));
  if ((r.warnings || []).length) out();
  out();
  if (v.fitsHardLimit) out(C.green(`  ✔ ${formatBytes(r.after)} ≤ 上限 ${formatBytes(r.target.hardBytes)}，可以发`));
  else out(C.red(`  ✘ 还是超了 ${formatBytes(r.after - r.target.hardBytes)}`));
  if (v.durationOk === false) out(C.yellow(`  ! 时长 ${formatDuration(r.inputInfo.durationSec)} 超过 ${r.target.label} 的 ${formatDuration(r.target.maxDurationSec)}`));
  if (r.alternatives?.length) {
    out();
    out(C.bold('  换个思路：'));
    for (const a of r.alternatives) out(C.dim(`    · ${a.text}`));
  }
  out();
  out(`  ${C.dim('产出：')}${r.output}`);
}

async function cardFor(file, result, { ffmpeg, out: cardOut } = {}) {
  const cardPath = cardOut || path.join(path.dirname(result.output), `${path.basename(result.output, '.mp4')}.card.html`);
  const poster = await extractPoster(result.output, { ffmpeg });
  const posterName = poster?.path ? path.basename(poster.path) : '';
  const checks = platformChecks(result.afterInfo || result.inputInfo);
  const html = cardHtml({
    videoPath: path.basename(result.output),
    posterName,
    meta: {
      beforeBytes: result.before,
      afterBytes: result.after,
      target: result.target.label,
      durationSec: result.inputInfo.durationSec,
      resolution: `${result.afterInfo?.video.displayWidth ?? result.inputInfo.video.displayWidth}×${result.afterInfo?.video.displayHeight ?? result.inputInfo.video.displayHeight}`,
      contentLabel: result.content.label,
      bitrate: formatBitrate(result.afterInfo?.bitrateBps),
      encodeSeconds: result.encodeSeconds,
      verdict: result.verdict,
      platformChecks: checks,
      alternatives: result.alternatives,
    },
  });
  writeFileSync(cardPath, html, 'utf8');
  return cardPath;
}

// —— 命令实现 ——

const commands = {
  async help() { out(HELP); },

  async platforms(args) {
    const db = loadPlatforms();
    if (args.json) {
      out(JSON.stringify(db.targets, null, 2));
      return;
    }
    out();
    out(`${C.bold('平台限制速查')} ${C.dim(`更新于 ${db.updatedAt}`)}`);
    out(C.dim(db.disclaimer));
    out();
    for (const t of db.targets) {
      const conf = t.confidence === 'official' ? C.green('官方') : t.confidence === 'community' ? C.dim('社区') : C.yellow('口径不一');
      out(`${C.bold(t.id)}  ${t.label}  ${conf}`);
      out(`  体积上限 ${formatBytes(t.maxBytes)}${t.suggestedMaxBytes ? C.dim(`（建议压到 ${formatBytes(t.suggestedMaxBytes)}）`) : ''}${t.maxDurationSec ? `   时长上限 ${formatDuration(t.maxDurationSec)}` : ''}`);
      for (const n of t.notes || []) out(C.dim(`  · ${n}`));
      for (const s of t.sources || []) out(C.dim(`  来源 ${s.url} — ${s.note}`));
      out();
    }
  },

  async doctor() {
    const r = await doctor();
    out(formatDoctor(r));
    if (!r.ok) process.exitCode = 2;
  },

  async inspect(args) {
    const bins = await binariesOrDie();
    const files = args._;
    if (!files.length) throw new Error('至少给一个文件：express inspect 视频.mp4');
    const results = [];
    for (const f of files) {
      const info = await probe(f, { ffprobe: bins.ffprobe });
      const checks = platformChecks(info);
      results.push({ file: f, info, checks });
      if (!args.json) printInspect(info, checks);
    }
    if (args.json) out(JSON.stringify(results, null, 2));
  },

  async fit(args) {
    const bins = await binariesOrDie();
    const input = args._[0];
    if (!input) throw new Error('用法：express fit 视频.mp4 --to wechat-chat');
    if (!args.to) throw new Error('必须给目标：--to wechat-chat 或 --to 25MB（用 express platforms 看有哪些目标）');

    const t0 = Date.now();
    const result = await fit(input, {
      to: args.to,
      preset: args.preset || 'balanced',
      out: args.out,
      speed: args.speed || 'medium',
      maxPasses: Number(args['max-passes'] || 4),
      dryRun: Boolean(args['dry-run']),
      normalize: Boolean(args.normalize),
      ffmpeg: bins.ffmpeg,
      ffprobe: bins.ffprobe,
      onProgress: progressReporter('压缩中'),
      onPass: () => {},
    });
    if (process.stdout.isTTY) process.stdout.write('\r' + ' '.repeat(24) + '\r');
    const encodeSeconds = Math.round(((Date.now() - t0) / 1000) * 10) / 10;
    result.encodeSeconds = encodeSeconds;

    if (args.json) {
      out(JSON.stringify(result, null, 2));
    } else if (args['dry-run']) {
      out();
      out(`${C.bold('压缩计划')} ${C.dim('（--dry-run，没有真压）')}`);
      out(`  目标 ${result.target.label}  ${formatBytes(result.target.hardBytes)}`);
      out(`  内容 ${result.content.label}`);
      for (const p of result.passes) {
        const r = estimateRange({
          width: p.width, height: p.height, fps: p.fps, crf: p.crf ?? 30,
          kind: result.content.kind, durationSec: result.inputInfo.durationSec,
          audioBytes: p.hasAudio ? 0 : 0,
        });
        out(C.dim(`    ${p.width}×${p.height} ${p.fps}fps CRF${p.crf ?? '—'}  预估 ${formatBytes(r.low)} ~ ${formatBytes(r.high)}`));
      }
      out();
      out(C.dim('  预估是粗略区间：不同内容的压缩难度能差几倍，所以给区间而不是一个看着精确的数字。'));
      out(C.dim('  实际以压完量到的为准——超了会自动试下一档，直到达标或明确说压不进去。'));
      out();
    } else {
      printFit(result, encodeSeconds);
    }

    if (!args['dry-run']) {
      if (args.ledger !== false) {
        try { appendEntry(toEntry(result, { encodeSeconds })); } catch { /* 台账写不进去不该影响主流程 */ }
      }
      if (args.card) {
        const cardPath = await cardFor(input, result, { ffmpeg: bins.ffmpeg });
        out(C.dim(`  投递卡 ${cardPath}`));
      }
      if (result.verdict.fitsHardLimit === false) process.exitCode = 1;
    }
  },

  async trim(args) {
    const bins = await binariesOrDie();
    const input = args._[0];
    if (!input) throw new Error('用法：express trim 视频.mp4 --start 0:10 --end 1:20');
    const r = await trim(input, {
      start: args.start || 0,
      end: args.end ?? null,
      duration: args.duration ?? null,
      out: args.out,
      reencode: args.fast !== true,
      ffmpeg: bins.ffmpeg,
      ffprobe: bins.ffprobe,
      onProgress: progressReporter('裁剪中'),
    });
    out();
    out(`${C.bold('裁好了')}  ${formatBytes(r.before)} ${C.dim('→')} ${formatBytes(r.after)}`);
    out(`  片段 ${formatDuration(r.startSec)} 起 ${r.durationSec ? formatDuration(r.durationSec) : '到结尾'}`);
    out(`  ${C.dim('产出：')}${r.output}`);
    out();
  },

  async gif(args) {
    const bins = await binariesOrDie();
    const input = args._[0];
    if (!input) throw new Error('用法：express gif 视频.mp4 --width 320 --square');
    const r = await toGif(input, {
      out: args.out,
      width: Number(args.width || 320),
      fps: Number(args.fps || 12),
      start: Number(args.start || 0),
      duration: args.duration ? Number(args.duration) : null,
      cropSquare: Boolean(args.square),
      ffmpeg: bins.ffmpeg,
      onProgress: progressReporter('转 GIF'),
    });
    if (process.stdout.isTTY) process.stdout.write('\r' + ' '.repeat(24) + '\r');
    out();
    out(`${C.bold('GIF 好了')}  ${formatBytes(r.bytes)}  ${r.width}px ${r.fps}fps`);
    for (const w of r.warnings) out(C.yellow(`  ! ${w}`));
    if (!r.warnings.length) out(C.green(`  ✔ 在微信表情 1MB 上限之内`));
    out(`  ${C.dim('产出：')}${r.output}`);
    out();
  },

  async split(args) {
    const bins = await binariesOrDie();
    const input = args._[0];
    if (!input) throw new Error('用法：express split 视频.mp4 --to wechat-chat');
    if (!args.to) throw new Error('必须给目标：--to wechat-chat 或 --to 25MB');
    const r = await split(input, {
      to: args.to,
      parts: args.parts ? Number(args.parts) : null,
      outDir: args.out || null,
      preset: args.preset || 'balanced',
      speed: args.speed || 'medium',
      ffmpeg: bins.ffmpeg,
      ffprobe: bins.ffprobe,
      maxPasses: Number(args['max-passes'] || 3),
      onProgress: progressReporter('分段压缩'),
      onPart: (p) => out(C.dim(`  第 ${p.index}/${p.of} 段 → ${formatBytes(p.bytes)} ${p.fits ? C.green('✔') : C.red('✘')}`)),
    });
    if (process.stdout.isTTY) process.stdout.write('\r' + ' '.repeat(24) + '\r');

    if (r.action === 'noop') {
      out();
      out(C.green(`✔ ${r.reason}`));
      out();
      return;
    }
    out();
    out(`${C.bold(`切成了 ${r.segments.length} 段`)} ${C.dim(`每段都压到 ${r.target.label} 以内`)}`);
    for (const s of r.segments) {
      out(`  ${String(s.index).padStart(2)}  ${s.startText} → ${s.endText}   ${formatBytes(s.bytes).padStart(9)}  ${s.fits ? C.green('✔') : C.red('✘ 超限')}`);
    }
    out();
    if (r.allFit) {
      out(C.green(`  ✔ 每段都在 ${formatBytes(r.target.hardBytes)} 以内`));
      out(C.dim(`  目录 ${r.dir}`));
    } else {
      out(C.red(`  ✘ 第 ${r.overSegments.join('、')} 段仍然超限`));
      out(C.dim('  试试 --parts 给更多段数，或者把 --to 调小'));
    }
    if (args.ledger !== false) {
      for (const s of r.segments) {
        try {
          appendEntry({
            action: 'split', input, output: s.path,
            targetId: r.target.kind === 'platform' ? r.target.platform.id : 'custom',
            targetLabel: r.target.label,
            beforeBytes: s.bytes, afterBytes: s.bytes,
            durationSec: s.end - s.start, contentKind: s.content?.kind ?? null,
            passCount: 0, fitsHardLimit: s.fits, encodeSeconds: null,
          });
        } catch { /* 台账写不进去不影响主流程 */ }
      }
    }
    out();
  },

  async card(args) {
    const bins = await binariesOrDie();
    const input = args._[0];
    if (!input) throw new Error('用法：express card 视频.mp4');
    const info = await probe(input, { ffprobe: bins.ffprobe });
    // 顺序很重要：先定卡片落在哪，封面再抽到**卡片同目录**。
    // 之前封面默认抽到「视频所在目录」，于是 `--out` 指到别处时，
    // 卡片里的 poster="xxx.cover.jpg" 这个相对路径会指错地方 —— 在别处打开是张没有封面的卡。
    const cardPath = args.out
      ? path.resolve(args.out)
      : path.join(path.dirname(input), `${path.basename(input, path.extname(input))}.card.html`);
    const cardDir = path.dirname(cardPath);
    mkdirSync(cardDir, { recursive: true });
    const poster = await extractPoster(input, {
      ffmpeg: bins.ffmpeg,
      out: path.join(cardDir, `${path.basename(input, path.extname(input))}.cover.jpg`),
    });
    const beforeBytes = args.from && existsSync(args.from) ? statSync(args.from).size : null;
    const target = args.to ? resolveTarget(args.to) : null;
    const checks = platformChecks(info).filter((c) => (target ? c.id === target.platform?.id : true));
    // 独立生成卡片时也要量一次内容判定，否则卡片上「内容判定」那一栏是空的，
    // 而这恰恰是投递方最想看的信息之一（决定对方会看到多糊的画面）
    const content = await analyzeContent(input, {
      ff: bins.ffmpeg.path,
      durationSec: info.durationSec,
      width: info.video.displayWidth,
      height: info.video.displayHeight,
    });
    const html = cardHtml({
      videoPath: path.basename(input),
      posterName: poster.path ? path.basename(poster.path) : '',
      meta: {
        beforeBytes,
        afterBytes: info.sizeBytes,
        target: target?.label ?? null,
        durationSec: info.durationSec,
        resolution: `${info.video.displayWidth}×${info.video.displayHeight}`,
        contentLabel: content.label,
        bitrate: formatBitrate(info.bitrateBps),
        verdict: { fitsHardLimit: target ? info.sizeBytes <= target.hardBytes : null, durationOk: target?.maxDurationSec ? info.durationSec <= target.maxDurationSec : null },
        platformChecks: checks,
      },
    });
    writeFileSync(cardPath, html, 'utf8');
    out(`${C.green('✔')} 投递卡 ${cardPath}`);
    if (poster.path) out(C.dim(`  封面   ${poster.path}`));
    // 视频不在卡片旁边时要提示：卡片里引用的是文件名，连同视频一起发给别人就会缺文件。
    // 判断得看「视频在不在**卡片**目录」——之前写成查视频在不在它自己的目录，那永远成立，
    // 于是提示语从来没打印过，测出来「静默」正好是它的表现。
    if (!existsSync(path.join(cardDir, path.basename(input)))) {
      out(C.dim('  注意：视频不在卡片同一目录，卡片在这里能看，但连同视频一起发给别人会缺文件。'));
      out(C.dim(`  要一起发的话，把视频也拷到 ${cardDir}`));
    }
  },

  async ledger(args) {
    const entries = readEntries();
    const s = summarize(entries);
    if (args.json) { out(JSON.stringify({ summary: s, entries }, null, 2)); return; }
    out();
    out(`${C.bold('压缩台账')}  ${C.dim(ledgerPath())}`);
    if (!entries.length) { out(C.dim('  还是空的——先压一个视频。')); out(); return; }
    out(`  共 ${s.count} 次，省下 ${C.green(formatBytes(s.savedBytes))}，平均 ${s.savedRatio?.toFixed(1)}×`);
    for (const t of s.byTarget) {
      out(C.dim(`  ${t.target}：${t.count} 次，${formatBytes(t.before)} → ${formatBytes(t.after)}`));
    }
    const htmlPath = args.out || path.join(process.cwd(), 'express-台账.html');
    writeReport(htmlPath, s, entries);
    out();
    out(`  ${C.green('✔')} 报告 ${htmlPath}`);
    out();
  },
};

export async function main(argv = process.argv.slice(2)) {
  const known = new Set(Object.keys(commands));
  const cmd = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'help';
  const rest = argv[0] && !argv[0].startsWith('-') ? argv.slice(1) : argv;

  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      options: {
        to: { type: 'string' },
        out: { type: 'string' },
        preset: { type: 'string' },
        speed: { type: 'string' },
        'max-passes': { type: 'string' },
        start: { type: 'string' },
        end: { type: 'string' },
        duration: { type: 'string' },
        width: { type: 'string' },
        fps: { type: 'string' },
        from: { type: 'string' },
        parts: { type: 'string' },
        json: { type: 'boolean' },
        card: { type: 'boolean' },
        'dry-run': { type: 'boolean' },
        square: { type: 'boolean' },
        normalize: { type: 'boolean' },
        fast: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean' },
        ledger: { type: 'boolean' },
      },
      allowPositionals: true,
      strict: false,
    });
  } catch (err) {
    out(C.red(`参数有误：${err.message}`));
    out(C.dim('跑 express help 看用法'));
    process.exitCode = 2;
    return;
  }

  const args = { ...parsed.values, _: parsed.positionals };
  if (args['no-ledger']) args.ledger = false;
  if (args.version) { out(JSON.parse((await import('node:fs')).readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version); return; }
  if (args.help || cmd === 'help' || !known.has(cmd)) {
    if (cmd && !known.has(cmd) && cmd !== 'help') out(C.red(`没有这个命令：${cmd}`));
    await commands.help(args);
    if (cmd && !known.has(cmd) && cmd !== 'help') process.exitCode = 2;
    return;
  }

  try {
    await commands[cmd](args);
  } catch (err) {
    out(C.red(`✘ ${err.message}`));
    if (process.env.EXPRESS_DEBUG) out(C.dim(String(err.stack)));
    process.exitCode = 1;
  }
}
