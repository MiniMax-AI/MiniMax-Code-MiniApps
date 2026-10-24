// Media tools.
//
// These are the operations the reference implementation runs on the local
// ffmpeg binary (core/videotools.py and core/imagetools.py), ported to the
// MiniApp runtime. The provider is not involved: the tools transform a media
// file the canvas already has into a new one.
//
// Every parameter that reaches an ffmpeg filter is validated first, so a
// value coming from the page can never become filter syntax.
//
// Four of the reference implementation's image tools are deliberately not
// here: see RETIRED_TOOLS at the bottom of this file.


const NAMED_COLORS = {
  white: 'ffffff',
  black: '000000',
  green: '00ff00',
  blue: '0000ff',
  red: 'ff0000',
  gray: '808080',
  grey: '808080',
  yellow: 'ffff00',
  cyan: '00ffff',
  magenta: 'ff00ff',
};

// The named palette for the chroma key, which needs fully saturated colors.
const KEY_COLORS = {
  green: '00ff00',
  blue: '0000ff',
  cyan: '00ffff',
  red: 'ff0000',
  magenta: 'ff00ff',
  white: 'ffffff',
  black: '000000',
};

const ASPECT_TARGETS = {
  '9:16': [9, 16],
  '16:9': [16, 9],
  '1:1': [1, 1],
  '4:3': [4, 3],
  '3:4': [3, 4],
};

const ID_PHOTO_SIZES = {
  一寸: [295, 413],
  小一寸: [260, 378],
  大一寸: [390, 567],
  二寸: [413, 579],
  小二寸: [413, 531],
  大二寸: [626, 826],
  签证: [390, 567],
  护照: [390, 567],
};

export class MediaToolError extends Error {
  constructor(message, code = 'MEDIA_TOOL_FAILED') {
    super(message);
    this.code = code;
  }
}

// ---------------------------------------------------------------- parameters

function num(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

function oneOf(value, allowed, fallback) {
  const text = String(value ?? '').trim();
  return allowed.includes(text) ? text : fallback;
}

/** `#RRGGBB` or a color name → `RRGGBB`. Anything else is rejected. */
function hexColor(value, fallback, palette = NAMED_COLORS) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  if (palette[raw]) return palette[raw];
  const clean = raw.replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/.test(clean)) {
    throw new MediaToolError('颜色要写成 #RRGGBB 这样的形式', 'INVALID_ARGUMENTS');
  }
  return clean;
}

// delogo refuses a rectangle that touches the frame edge: there is no
// neighbouring pixel to interpolate from, and ffmpeg reports "Logo area is
// outside of the frame". The area is inset by a pixel and clipped to the
// frame, so a corner rectangle still works.
export function delogoRect(info, x, y, w, h) {
  const iw = info.width || 0;
  const ih = info.height || 0;
  let rx = Math.max(0, Math.round(x));
  let ry = Math.max(0, Math.round(y));
  let rw = Math.max(8, Math.round(w));
  let rh = Math.max(8, Math.round(h));
  if (iw && ih) {
    rx = Math.min(rx, Math.max(0, iw - 2));
    ry = Math.min(ry, Math.max(0, ih - 2));
    rw = Math.min(rw, Math.max(1, iw - rx - 1));
    rh = Math.min(rh, Math.max(1, ih - ry - 1));
  }
  const ix = Math.max(1, rx);
  const iy = Math.max(1, ry);
  return {
    x: ix,
    y: iy,
    w: Math.max(2, Math.min(rw, iw ? iw - ix - 1 : rw)),
    h: Math.max(2, Math.min(rh, ih ? ih - iy - 1 : rh)),
  };
}

// ------------------------------------------------------------------- tools

/**
 * The tool catalogue.
 *
 * `kind` is the node kind the tool leaves behind, `ext`/`mimeType` describe
 * the produced file, and `params` is the parameter contract the page renders
 * from. `run` receives the sanitized parameters plus the local paths.
 */
export const MEDIA_TOOLS = {
  // ---------------- video ----------------
  frame: {
    label: '抽帧',
    kind: 'image',
    ext: '.jpg',
    mimeType: 'image/jpeg',
    params: [
      { key: 'position', label: '位置', type: 'select', options: ['首帧', '尾帧'], default: '首帧' },
    ],
    async run({ ffmpeg, params, source, out }) {
      const position = oneOf(params.position, ['首帧', '尾帧'], '首帧');
      const target = out('.jpg');
      if (position === '尾帧') {
        const info = await ffmpeg.probe(source);
        const seconds = Math.max(0, (info.duration || 0) - 0.15);
        await ffmpeg.run(['-ss', seconds.toFixed(3), '-i', source, '-frames:v', '1', '-q:v', '2', target]);
      } else {
        await ffmpeg.run(['-ss', '0.000', '-i', source, '-frames:v', '1', '-q:v', '2', target]);
      }
      return [{ path: target, kind: 'image', mimeType: 'image/jpeg' }];
    },
  },

  frameGrid: {
    label: '宫格抽帧',
    kind: 'image',
    ext: '.jpg',
    mimeType: 'image/jpeg',
    params: [
      { key: 'count', label: '格数', type: 'number', default: 9, min: 2, max: 25 },
    ],
    async run({ ffmpeg, params, source, out }) {
      const count = Math.round(num(params.count, 9, { min: 2, max: 25 }));
      const info = await ffmpeg.probe(source);
      const duration = info.duration || 0;
      if (duration <= 0) throw new MediaToolError('读不到视频时长', 'MEDIA_TOOL_FAILED');
      const cols = count <= 9 ? 3 : count <= 16 ? 4 : 5;
      const rows = Math.ceil(count / cols);
      const step = duration / count;
      const target = out('.jpg');
      // The tile filter only emits once it has collected a full grid, so the
      // frame count is stated explicitly: a count that does not fill the grid
      // (ten frames in a 3x4 grid) would otherwise produce no file at all.
      await ffmpeg.run([
        '-i', source,
        '-vf', `fps=1/${step.toFixed(4)},scale=320:-1,tile=${cols}x${rows}:nb_frames=${count}`,
        '-frames:v', '1', target,
      ]);
      return [{ path: target, kind: 'image', mimeType: 'image/jpeg' }];
    },
  },

  trim: {
    label: '片段剪辑',
    kind: 'video',
    ext: '.mp4',
    mimeType: 'video/mp4',
    params: [
      { key: 'start', label: '起点（秒）', type: 'number', default: 0, min: 0 },
      { key: 'end', label: '终点（秒）', type: 'number', default: 5, min: 0.2 },
    ],
    async run({ ffmpeg, params, source, out }) {
      const start = num(params.start, 0, { min: 0 });
      const end = Math.max(start + 0.2, num(params.end, start + 5, { min: 0.2 }));
      const target = out('.mp4');
      await ffmpeg.run([
        '-ss', start.toFixed(3), '-to', end.toFixed(3), '-i', source,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
        '-c:a', 'aac', '-movflags', '+faststart', target,
      ]);
      return [{ path: target, kind: 'video', mimeType: 'video/mp4' }];
    },
  },

  cropVideo: {
    label: '视频剪裁',
    kind: 'video',
    ext: '.mp4',
    mimeType: 'video/mp4',
    params: [
      {
        key: 'target',
        label: '画幅',
        type: 'select',
        options: ['9:16', '16:9', '1:1', '4:3', '3:4'],
        default: '9:16',
      },
    ],
    async run({ ffmpeg, params, source, out }) {
      const target = oneOf(params.target, Object.keys(ASPECT_TARGETS), '9:16');
      const [tw, th] = ASPECT_TARGETS[target];
      const info = await ffmpeg.probe(source);
      const w = info.width || 0;
      const h = info.height || 0;
      if (!w || !h) throw new MediaToolError('读不到视频分辨率', 'MEDIA_TOOL_FAILED');
      // Keep the short side and crop the long one to the target ratio.
      let nw;
      let nh;
      if (w * th > h * tw) {
        nw = Math.floor((h * tw) / th / 2) * 2;
        nh = h;
      } else {
        nw = w;
        nh = Math.floor((w * th) / tw / 2) * 2;
      }
      const x = Math.floor((w - nw) / 2);
      const y = Math.floor((h - nh) / 2);
      const result = out('.mp4');
      await ffmpeg.run([
        '-i', source, '-vf', `crop=${nw}:${nh}:${x}:${y}`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
        '-c:a', 'aac', '-movflags', '+faststart', result,
      ]);
      return [{ path: result, kind: 'video', mimeType: 'video/mp4' }];
    },
  },

  autoSegment: {
    label: '自动分段',
    kind: 'video',
    ext: '.mp4',
    mimeType: 'video/mp4',
    params: [
      { key: 'threshold', label: '切分灵敏度', type: 'number', default: 0.3, min: 0.05, max: 0.9 },
    ],
    async run({ ffmpeg, params, source, out }) {
      const threshold = num(params.threshold, 0.3, { min: 0.05, max: 0.9 });
      const info = await ffmpeg.probe(source);
      const duration = info.duration || 0;
      const bounds = new Set([0]);
      const points = await detectScenes(ffmpeg, source, threshold);
      for (const point of points) bounds.add(point);
      bounds.add(duration);
      const ordered = [...bounds].filter((value) => value >= 0).sort((a, b) => a - b);
      const artifacts = [];
      for (let i = 0; i < ordered.length - 1; i += 1) {
        const start = ordered[i];
        const end = ordered[i + 1];
        if (end - start < 0.2) continue;
        const target = out('.mp4');
        await ffmpeg.run([
          '-ss', start.toFixed(3), '-to', end.toFixed(3), '-i', source,
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
          '-c:a', 'aac', '-movflags', '+faststart', target,
        ]);
        artifacts.push({ path: target, kind: 'video', mimeType: 'video/mp4' });
      }
      if (!artifacts.length) throw new MediaToolError('没有检测到镜头切换点', 'MEDIA_TOOL_FAILED');
      return artifacts;
    },
  },

  splitAv: {
    label: '音画分离',
    kind: 'audio',
    ext: '.m4a',
    mimeType: 'audio/mp4',
    params: [],
    async run({ ffmpeg, source, out }) {
      const info = await ffmpeg.probe(source);
      const video = out('.mp4');
      await ffmpeg.run(['-i', source, '-an', '-c:v', 'copy', video]);
      if (!info.hasAudio) {
        return [{ path: video, kind: 'video', mimeType: 'video/mp4' }];
      }
      const audio = out('.m4a');
      await ffmpeg.run(['-i', source, '-vn', '-c:a', 'aac', '-b:a', '192k', audio]);
      return [
        { path: video, kind: 'video', mimeType: 'video/mp4' },
        { path: audio, kind: 'audio', mimeType: 'audio/mp4' },
      ];
    },
  },

  merge: {
    label: '合并视频',
    kind: 'video',
    ext: '.mp4',
    mimeType: 'video/mp4',
    params: [],
    async run({ ffmpeg, sources, out, store }) {
      const files = (sources ?? []).filter(Boolean);
      if (files.length < 2) {
        throw new MediaToolError('至少要接两个视频节点才能合并', 'INVALID_ARGUMENTS');
      }
      const listFile = await store.writeTemp('concat.txt', `${files.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join('\n')}\n`);
      const target = out('.mp4');
      await ffmpeg.run([
        '-f', 'concat', '-safe', '0', '-i', listFile,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
        '-c:a', 'aac', '-movflags', '+faststart', target,
      ]);
      return [{ path: target, kind: 'video', mimeType: 'video/mp4' }];
    },
  },

  eraseSubtitle: {
    label: '字幕擦除',
    kind: 'video',
    ext: '.mp4',
    mimeType: 'video/mp4',
    params: [
      { key: 'position', label: '位置', type: 'select', options: ['底部', '顶部'], default: '底部' },
      { key: 'band', label: '带宽', type: 'number', default: 0.12, min: 0.04, max: 0.4 },
    ],
    async run({ ffmpeg, params, source, out }) {
      const position = oneOf(params.position, ['底部', '顶部'], '底部');
      const band = num(params.band, 0.12, { min: 0.04, max: 0.4 });
      const info = await ffmpeg.probe(source);
      const w = info.width || 0;
      const h = info.height || 0;
      if (!w || !h) throw new MediaToolError('读不到视频分辨率', 'MEDIA_TOOL_FAILED');
      const bh = Math.max(24, Math.round(h * band));
      const y = position === '顶部' ? Math.round(h * 0.04) : h - bh - Math.round(h * 0.04);
      // delogo needs a rectangle that does not touch the edge, or there is no
      // neighbouring pixel to interpolate from.
      const rect = delogoRect(info, 2, y, Math.max(8, w - 4), bh);
      const target = out('.mp4');
      await ffmpeg.run([
        '-i', source, '-vf', `delogo=x=${rect.x}:y=${rect.y}:w=${rect.w}:h=${rect.h}`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
        '-c:a', 'copy', '-movflags', '+faststart', target,
      ]);
      return [{ path: target, kind: 'video', mimeType: 'video/mp4' }];
    },
  },

  removeWatermark: {
    label: '视频去水印',
    kind: 'video',
    ext: '.mp4',
    mimeType: 'video/mp4',
    params: [
      { key: 'x', label: '左', type: 'number', default: 0, min: 0 },
      { key: 'y', label: '上', type: 'number', default: 0, min: 0 },
      { key: 'w', label: '宽', type: 'number', default: 200, min: 8 },
      { key: 'h', label: '高', type: 'number', default: 80, min: 8 },
    ],
    async run({ ffmpeg, params, source, out }) {
      const w = Math.round(num(params.w, 200, { min: 8 }));
      const h = Math.round(num(params.h, 80, { min: 8 }));
      if (w <= 0 || h <= 0) throw new MediaToolError('要去掉的区域得给个宽高', 'INVALID_ARGUMENTS');
      const info = await ffmpeg.probe(source);
      const rect = delogoRect(info, num(params.x, 0, { min: 0 }), num(params.y, 0, { min: 0 }), w, h);
      const target = out('.mp4');
      await ffmpeg.run([
        '-i', source, '-vf', `delogo=x=${rect.x}:y=${rect.y}:w=${rect.w}:h=${rect.h}`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
        '-c:a', 'copy', '-movflags', '+faststart', target,
      ]);
      return [{ path: target, kind: 'video', mimeType: 'video/mp4' }];
    },
  },

  removeBg: {
    label: '背景移除',
    kind: 'video',
    ext: '.webm',
    mimeType: 'video/webm',
    params: [
      { key: 'color', label: '背景色', type: 'select', options: ['green', 'blue', 'cyan', 'red', 'white', 'black'], default: 'green' },
      { key: 'similarity', label: '容差', type: 'number', default: 0.22, min: 0.01, max: 1 },
    ],
    async run({ ffmpeg, params, source, out }) {
      const color = hexColor(params.color, '00ff00', KEY_COLORS);
      const similarity = num(params.similarity, 0.22, { min: 0.01, max: 1 });
      const target = out('.webm');
      await ffmpeg.run([
        '-i', source, '-vf', `format=yuva420p,chromakey=0x${color}:${similarity.toFixed(3)}:0.08`,
        '-c:v', 'libvpx-vp9', '-b:v', '2M', '-c:a', 'libopus', target,
      ]);
      return [{ path: target, kind: 'video', mimeType: 'video/webm' }];
    },
  },

  // ---------------- image ----------------
  cutout: {
    label: '智能抠图',
    kind: 'image',
    ext: '.png',
    mimeType: 'image/png',
    params: [
      { key: 'color', label: '背景色', type: 'select', options: ['white', 'green', 'blue', 'black'], default: 'white' },
      { key: 'similarity', label: '容差', type: 'number', default: 0.14, min: 0.01, max: 1 },
    ],
    async run({ ffmpeg, params, source, out }) {
      const color = hexColor(params.color, 'ffffff');
      const similarity = num(params.similarity, 0.14, { min: 0.01, max: 1 });
      const target = out('.png');
      await ffmpeg.run([
        '-i', source, '-vf', `format=rgba,colorkey=0x${color}:${similarity.toFixed(3)}:0.08`,
        '-frames:v', '1', target,
      ]);
      return [{ path: target, kind: 'image', mimeType: 'image/png' }];
    },
  },

  enhance: {
    label: '变清晰',
    kind: 'image',
    ext: '.png',
    mimeType: 'image/png',
    params: [
      { key: 'scale', label: '放大倍数', type: 'number', default: 2, min: 1, max: 4 },
      { key: 'sharp', label: '锐化强度', type: 'number', default: 1.4, min: 0, max: 5 },
    ],
    async run({ ffmpeg, params, source, out }) {
      const scale = num(params.scale, 2, { min: 1, max: 4 });
      const sharp = num(params.sharp, 1.4, { min: 0, max: 5 });
      const target = out('.png');
      await ffmpeg.run([
        '-i', source,
        '-vf', `scale=iw*${Math.round(scale)}:ih*${Math.round(scale)}:flags=lanczos,hqdn3d=2:1.5:4:3,unsharp=5:5:${sharp.toFixed(2)}:5:5:0.0,eq=brightness=0.02:saturation=1.05`,
        '-frames:v', '1', target,
      ]);
      return [{ path: target, kind: 'image', mimeType: 'image/png' }];
    },
  },

  resize: {
    label: '无损改尺寸',
    kind: 'image',
    ext: '.png',
    mimeType: 'image/png',
    params: [
      { key: 'width', label: '宽', type: 'number', default: 1080, min: 16, max: 8192 },
      { key: 'height', label: '高', type: 'number', default: 1080, min: 16, max: 8192 },
      { key: 'mode', label: '方式', type: 'select', options: ['fit', 'fill', 'stretch'], default: 'fit' },
    ],
    async run({ ffmpeg, params, source, out }) {
      const width = Math.round(num(params.width, 1080, { min: 16, max: 8192 }));
      const height = Math.round(num(params.height, 1080, { min: 16, max: 8192 }));
      const mode = oneOf(params.mode, ['fit', 'fill', 'stretch'], 'fit');
      const target = out('.png');
      const vf =
        mode === 'stretch'
          ? `scale=${width}:${height}`
          : mode === 'fill'
            ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`
            : `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=white`;
      await ffmpeg.run(['-i', source, '-vf', vf, '-frames:v', '1', target]);
      return [{ path: target, kind: 'image', mimeType: 'image/png' }];
    },
  },

  idPhoto: {
    label: '证件照',
    kind: 'image',
    ext: '.jpg',
    mimeType: 'image/jpeg',
    params: [
      { key: 'preset', label: '规格', type: 'select', options: Object.keys(ID_PHOTO_SIZES), default: '一寸' },
    ],
    async run({ ffmpeg, params, source, out }) {
      const preset = oneOf(params.preset, Object.keys(ID_PHOTO_SIZES), '一寸');
      const [w, h] = ID_PHOTO_SIZES[preset];
      const target = out('.jpg');
      await ffmpeg.run([
        '-i', source,
        '-vf',
        `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},` +
          `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=white`,
        '-frames:v', '1', target,
      ]);
      return [{ path: target, kind: 'image', mimeType: 'image/jpeg' }];
    },
  },
};

// The scene-cut points, read from an info-level pass so the quiet log level
// used everywhere else does not hide the filter report.
async function detectScenes(ffmpeg, source, threshold) {
  const probe = await ffmpeg.run(
    ['-i', source, '-vf', `select='gt(scene,${threshold})',showinfo`, '-f', 'null', '-'],
    { logLevel: 'info' },
  );
  const points = new Set();
  const pattern = /pts_time:([0-9.]+)/g;
  const text = probe.stderr ?? '';
  let match = pattern.exec(text);
  while (match) {
    const time = Number(match[1]);
    if (Number.isFinite(time) && time > 0.05) points.add(Math.round(time * 1000) / 1000);
    match = pattern.exec(text);
  }
  return [...points].sort((a, b) => a - b);
}

// What each tool reads. The page already offers a tool only on a node of the
// matching kind; the runtime checks again, so a mismatched request is
// reported as such instead of failing inside ffmpeg.
export const TOOL_ACCEPTS = {
  frame: 'video',
  frameGrid: 'video',
  trim: 'video',
  cropVideo: 'video',
  autoSegment: 'video',
  splitAv: 'video',
  merge: 'video',
  eraseSubtitle: 'video',
  removeWatermark: 'video',
  removeBg: 'video',
  cutout: 'image',
  enhance: 'image',
  resize: 'image',
  idPhoto: 'image',
};

// What each tool leaves behind, in order. The page creates one node per
// produced file, and the first entry is the node kind the panel advertises.
export const TOOL_PRODUCES = {
  frame: ['image'],
  frameGrid: ['image'],
  trim: ['video'],
  cropVideo: ['video'],
  autoSegment: ['video'],
  splitAv: ['video', 'audio'],
  merge: ['video'],
  eraseSubtitle: ['video'],
  removeWatermark: ['video'],
  removeBg: ['video'],
  cutout: ['image'],
  enhance: ['image'],
  resize: ['image'],
  idPhoto: ['image'],
};

export function findMediaTool(key) {
  return MEDIA_TOOLS[key] ?? null;
}

export function mediaToolKeys() {
  return Object.keys(MEDIA_TOOLS);
}

/**
 * The image tools that are deliberately not offered.
 *
 * The reference implementation ships these, so the list is kept here: it says
 * they were taken out on purpose and why, so nobody reads the difference as an
 * oversight and puts them back. The rule behind it: a tool on a result node
 * is a shortcut for that one picture — 拼图 needs several pictures, 海报 came
 * out too rough, 去水印 needs a rectangle the user has to place, and 服装换色
 * shifts the hue of the whole picture, background included.
 */
export const RETIRED_TOOLS = {
  collage: '拼图要接好几张图，不是一张图的快捷处理',
  poster: '排版太粗，出来的海报不能用',
  deWatermark: '必须先框出要去掉的矩形，多一步交互就不算快捷方式',
  recolor: '整图色相偏移，背景跟着一起变，效果太差',
};
