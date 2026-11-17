// doctor：把「能不能跑」和「为什么跑不了」都讲清楚。
// 起因是 winget 升级后 WinGet\Links 里的 ffmpeg.exe 变成悬空符号链接：
// 路径能解析，一执行就报「系统找不到指定的文件」。这种情况必须说人话。
import { resolveBinaries, IS_WINDOWS } from './ffmpeg.js';

const NEEDED_ENCODERS = ['libx264', 'aac', 'gif'];

export async function doctor({ env = process.env } = {}) {
  const found = await resolveBinaries({ env });
  const checks = [];

  for (const name of ['ffmpeg', 'ffprobe']) {
    const bin = found[name];
    if (bin) {
      checks.push({ level: 'ok', name, text: `可用：${bin.path}`, detail: `${bin.version}（来源：${bin.source}）` });
    } else {
      checks.push({ level: 'bad', name, text: `没找到可用的 ${name}` });
    }
  }

  // 悬空链接这类「解析得到但跑不起来」的候选，单列出来——这比「没找到」有用得多
  const broken = found.rejected || [];
  for (const b of broken) {
    let why;
    if (b.reason === 'enoent') why = '路径能解析，但执行时找不到目标文件——典型的悬空符号链接';
    else if (b.reason === 'timeout') why = '执行超过 8 秒没有返回，疑似卡死';
    else why = `执行失败：${b.error || b.reason}`;
    checks.push({
      level: 'warn', name: b.name,
      text: `这个 ${b.name} 用不了：${b.path}`,
      detail: `${why}（来源：${b.from}）`,
    });
  }

  if (found.ffmpeg) {
    // 一次执行就够了：既要退出码，也要拿到编码器列表
    const { run } = await import('./ffmpeg.js');
    const enc = await run(found.ffmpeg.path, ['-hide_banner', '-encoders'], { maxBuffer: 4 * 1024 * 1024 });
    const text = (enc.stdout || '') + (enc.stderr || '');
    for (const e of NEEDED_ENCODERS) {
      const has = new RegExp(`(^|\\s)${e}(\\s|$)`, 'm').test(text);
      checks.push({
        level: has ? 'ok' : 'warn', name: e,
        text: has ? `编码器 ${e} 可用` : `没找到编码器 ${e}`,
        detail: has ? '' : 'H.264 是各平台兼容性最好的选择，缺它就得换 ffmpeg 构建（推荐 gyan.dev 的 essentials build）',
      });
    }

    // 处理旋转元数据要用 sidedata 滤镜（ffmpeg 6.0 才有）。缺了它，
    // 竖屏视频会被烤正一次之后又被播放器再转一次 —— 发出去是躺着的。
    const filters = await run(found.ffmpeg.path, ['-hide_banner', '-filters'], { maxBuffer: 4 * 1024 * 1024 });
    const ftext = (filters.stdout || '') + (filters.stderr || '');
    const hasSidedata = /(^|\s)sidedata(\s|$)/m.test(ftext);
    checks.push({
      level: hasSidedata ? 'ok' : 'warn', name: 'sidedata 滤镜',
      text: hasSidedata ? 'sidedata 滤镜可用（竖屏方向能处理干净）' : '没有 sidedata 滤镜，竖屏视频可能被重复旋转',
      detail: hasSidedata ? '' : '需要 ffmpeg ≥ 6.0。老版本遇到带旋转元数据的竖屏素材，请先用别的方式把方向烤进像素。',
    });
  }

  if (found.missing && broken.length) {
    checks.push({
      level: 'bad', name: '提示',
      text: '所有候选都跑不通',
      detail: '装一个：winget install ffmpeg，或者从 https://www.gyan.dev/ffmpeg/builds/ 下载后把 bin 目录加进 PATH',
    });
  }

  return { ok: Boolean(found.ffmpeg && found.ffprobe), checks, binaries: { ffmpeg: found.ffmpeg, ffprobe: found.ffprobe }, broken };
}

export function formatDoctor(result) {
  const icon = { ok: '✔', warn: '!', bad: '✘' };
  const lines = ['急件 · 环境体检', ''];
  for (const c of result.checks) {
    lines.push(`${icon[c.level]} ${c.text}`);
    if (c.detail) lines.push(`  ${c.detail}`);
  }
  lines.push('');
  lines.push(result.ok
    ? '环境就绪。试试：express inspect 你的视频.mp4'
    : '环境没就绪，先按上面的提示修 ffmpeg；修完再跑一次 express doctor。');
  return lines.join('\n');
}

export const isWindows = IS_WINDOWS;
