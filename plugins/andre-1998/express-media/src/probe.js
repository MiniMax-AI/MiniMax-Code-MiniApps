// 文件体检：把 ffprobe 的 JSON 变成一份「能拿来做判断」的 MediaInfo。
// 重点是把那些容易漏掉的字段捞出来：旋转、HDR、真实帧率、音频声道。
import { statSync } from 'node:fs';
import { run } from './ffmpeg.js';

export function parseRational(s) {
  if (!s || typeof s !== 'string') return null;
  const [num, den] = s.split('/');
  const n = Number(num);
  const d = den === undefined ? 1 : Number(den);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return n / d;
}

/** 新版 ffmpeg 把旋转放在 side_data_list，旧版放在 tags.rotate，两个都要认。 */
export function extractRotation(stream) {
  const list = Array.isArray(stream.side_data_list) ? stream.side_data_list : [];
  for (const sd of list) {
    if (typeof sd.rotation === 'number') return normalizeAngle(sd.rotation);
  }
  const tag = stream.tags && stream.tags.rotate;
  if (tag !== undefined && tag !== null && tag !== '') {
    const n = Number(tag);
    if (Number.isFinite(n)) return normalizeAngle(n);
  }
  return 0;
}

function normalizeAngle(deg) {
  const a = Math.round(deg) % 360;
  return a < 0 ? a + 360 : a;
}

export function isHdr(stream) {
  const t = String(stream.color_transfer || '');
  return t === 'smpte2084' || t === 'arib-std-b67';
}

/** 从 ffprobe 的 JSON 文本构造 MediaInfo（拆出来是为了能单测解析本身） */
export function parseProbe(json, { file, sizeBytes: sizeOverride } = {}) {
  let data;
  try {
    data = typeof json === 'string' ? JSON.parse(json) : json;
  } catch (err) {
    throw new Error(`无法解析 ffprobe 输出：${err.message}`);
  }
  const fmt = data.format || {};
  const streams = Array.isArray(data.streams) ? data.streams : [];
  const vs = streams.find((s) => s.codec_type === 'video');
  const as = streams.find((s) => s.codec_type === 'audio');

  const durationSec = num(fmt.duration) ?? (vs ? num(vs.duration) : null) ?? null;
  const sizeBytes = sizeOverride ?? num(fmt.size) ?? null;
  const overallBitrate = num(fmt.bit_rate) ?? (durationSec && sizeBytes ? Math.round((sizeBytes * 8) / durationSec) : null);

  const video = vs
    ? {
        present: true,
        codec: vs.codec_name || null,
        profile: vs.profile || null,
        width: num(vs.width) ?? null,
        height: num(vs.height) ?? null,
        fps: parseRational(vs.avg_frame_rate) ?? parseRational(vs.r_frame_rate) ?? null,
        nominalFps: parseRational(vs.r_frame_rate) ?? null,
        bitrateBps: num(vs.bit_rate) ?? null,
        pixFmt: vs.pix_fmt || null,
        rotation: extractRotation(vs),
        displayWidth: num(vs.coded_width) ?? num(vs.width) ?? null,
        displayHeight: num(vs.coded_height) ?? num(vs.height) ?? null,
        hdr: isHdr(vs),
        colorTransfer: vs.color_transfer || null,
        frameCount: num(vs.nb_frames) ?? null,
        hasBFrames: num(vs.has_b_frames) === 1,
      }
    // 没有视频轨时也要把字段补齐成 null：调用方写 info.video.displayWidth 不该
  // 在「有视频」和「没视频」两种情况下拿到 undefined 和 null 两种东西
    : {
        present: false, codec: null, profile: null, width: null, height: null,
        fps: null, nominalFps: null, bitrateBps: null, pixFmt: null, rotation: 0,
        displayWidth: null, displayHeight: null, hdr: false, colorTransfer: null,
        frameCount: null, hasBFrames: false,
      };

  const audio = as
    ? {
        present: true,
        codec: as.codec_name || null,
        sampleRate: num(as.sample_rate) ?? null,
        channels: num(as.channels) ?? null,
        channelLayout: as.channel_layout || null,
        bitrateBps: num(as.bit_rate) ?? null,
      }
    : {
        present: false, codec: null, sampleRate: null, channels: null,
        channelLayout: null, bitrateBps: null,
      };

  // 旋转 90/270 时，宽高对「观看者」来说是互换的
  const swap = video.rotation === 90 || video.rotation === 270;
  const displayW = swap ? video.height : video.width;
  const displayH = swap ? video.width : video.height;

  return {
    file: file ?? null,
    sizeBytes,
    durationSec,
    bitrateBps: overallBitrate,
    format: {
      name: fmt.format_name || null,
      longName: fmt.format_long_name || null,
      nbStreams: num(fmt.nb_streams) ?? streams.length,
    },
    video: {
      ...video,
      displayWidth: displayW ?? null,
      displayHeight: displayH ?? null,
      megapixels: displayW && displayH ? round2((displayW * displayH) / 1e6) : null,
      aspect: displayW && displayH ? round4(displayW / displayH) : null,
    },
    audio,
  };
}

function num(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function round2(n) { return Math.round(n * 100) / 100; }
function round4(n) { return Math.round(n * 10000) / 10000; }

/**
 * @param ffprobe 可以是「路径字符串」也可以是「{ path } 对象」。
 * 两种都收，是因为这两种传法在项目里都出现过，接口却只认一种——
 * 传错时的报错是 spawn 抱怨 "path argument must be of type string"，完全指不到真因。
 */
export async function probe(file, { ffprobe, stat = true } = {}) {
  const ffprobeBin = typeof ffprobe === 'string' ? ffprobe : ffprobe?.path;
  if (!ffprobeBin) throw new Error('缺少 ffprobe 路径，先跑 express doctor');
  if (!file) throw new Error('缺少要体检的文件路径');
  if (stat) {
    const st = statSync(file);
    if (!st.isFile()) throw new Error(`不是文件：${file}`);
    if (st.size === 0) throw new Error(`文件是空的（0 字节）：${file}`);
  }
  const { code, stdout, stderr } = await run(ffprobeBin, [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    file,
  ]);
  if (code !== 0) {
    throw new Error(`ffprobe 读不了这个文件（退出码 ${code}）：${file}\n${(stderr || '').trim()}`);
  }
  let sizeBytes = null;
  try { sizeBytes = statSync(file).size; } catch { /* 允许不 stat */ }
  return parseProbe(stdout, { file, sizeBytes });
}
