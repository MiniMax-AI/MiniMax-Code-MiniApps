// 程序排字用的字体：毛笔字随包带（vendor/fonts，SIL OFL 1.1），黑体、宋体、楷体用系统自带的。
// 只读字体文件，不写、不复制、不上传。macOS 的楷体、行楷是按需下载的，默认只有几十个字形的子集，
// 所以「楷体」在 macOS 上退回随包的毛笔楷书。
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listFaces, openFont } from './font.mjs';
import { probeChars } from './textlayout.mjs';

const VENDOR = fileURLToPath(new URL('../vendor/fonts/', import.meta.url));

// 规划节点写的 font 取值。chain：这一类字体依次尝试的来源，前面的没有就用后面的。
export const FONT_KINDS = {
  brush: { label: '毛笔楷书', chain: ['brush'], handwriting: true },
  xing: { label: '毛笔行书', chain: ['xing', 'brush'], handwriting: true },
  kai: { label: '楷体', chain: ['kai', 'brush'], handwriting: false },
  song: { label: '宋体', chain: ['song', 'hei', 'brush'], handwriting: false },
  hei: { label: '黑体', chain: ['hei', 'song', 'brush'], handwriting: false },
};

// 缺字时补字的顺序：主字体没有的字，按这个顺序找一个有的。
const FALLBACK_ORDER = ['hei', 'song', 'brush'];

function windowsFontDir() {
  return join(process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows', 'Fonts');
}

const SOURCES = {
  brush: [{ bundled: 'MaShanZheng-Regular.ttf', name: '马善政毛笔楷书 Ma Shan Zheng' }],
  xing: [{ bundled: 'ZhiMangXing-Regular.ttf', name: '钟齐志莽行书 Zhi Mang Xing' }],
  kai: [{ win: 'simkai.ttf', name: '楷体' }],
  song: [
    { mac: '/System/Library/Fonts/Supplemental/Songti.ttc', family: /宋体-简|Songti SC/, subfamily: /^Regular$/i, name: '宋体-简' },
    { win: 'simsun.ttc', index: 0, name: '宋体' },
  ],
  hei: [
    { mac: '/System/Library/Fonts/STHeiti Medium.ttc', family: /黑体-简|Heiti SC/, name: '黑体-简' },
    { mac: '/System/Library/Fonts/STHeiti Light.ttc', family: /黑体-简|Heiti SC/, name: '黑体-简' },
    { win: 'msyh.ttc', index: 0, name: '微软雅黑' },
    { win: 'simhei.ttf', name: '黑体' },
  ],
};

function sourcePath(source) {
  if (source.bundled) return join(VENDOR, source.bundled);
  if (source.mac) return source.mac;
  if (source.win) return join(windowsFontDir(), source.win);
  return '';
}

const cache = new Map();

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// 打开一个来源；文件不在、不是 TrueType 轮廓、找不到指定字面时返回 null。
async function openSource(source) {
  if (source.mac && process.platform !== 'darwin') return null;
  if (source.win && process.platform !== 'win32') return null;
  const path = sourcePath(source);
  if (!path || !(await exists(path))) return null;
  let index = source.index || 0;
  if (source.family) {
    const faces = await listFaces(path);
    const face = faces.find(
      (item) =>
        item.outlines === 'glyf' &&
        (source.family.test(item.family) || source.family.test(item.familyEn)) &&
        (!source.subfamily || source.subfamily.test(item.subfamily)),
    ) || faces.find((item) => item.outlines === 'glyf' && (source.family.test(item.family) || source.family.test(item.familyEn)));
    if (!face) return null;
    index = face.index;
  }
  const font = await openFont(path, { index });
  font.label = source.name;
  return font;
}

async function openKind(kind) {
  if (cache.has(kind)) return cache.get(kind);
  const task = (async () => {
    for (const source of SOURCES[kind] || []) {
      try {
        const font = await openSource(source);
        if (font) return font;
      } catch {
        // 换下一个来源。
      }
    }
    return null;
  })();
  cache.set(kind, task);
  return task;
}

// 本机每种书体实际会用哪个字体，写进规划提示词：没有楷体的机器上「楷体」落到毛笔楷书，
// 规划以为排的是识字教学用的标准楷体，交付的却是毛笔字（真机 20261117-f57a0f）。
// 返回 [{ kind, label, used（实际用的书体）, name（字体名）}]，used 为空表示这一类一个字体都没有。
export async function describeFontKinds() {
  const out = [];
  for (const [kind, spec] of Object.entries(FONT_KINDS)) {
    let used = '';
    let name = '';
    for (const candidate of spec.chain) {
      const font = await openKind(candidate);
      if (font) {
        used = candidate;
        name = font.label || font.family || '';
        break;
      }
    }
    out.push({ kind, label: spec.label, used, name });
  }
  return out;
}

export function normalizeFontKind(value) {
  const key = String(value || '').trim().toLowerCase();
  if (FONT_KINDS[key]) return key;
  // 行楷要的是清楚好认，和规划提示词一致归到毛笔楷书；行书、草书才用更连贯的行书字体。
  if (/行楷/.test(key)) return 'brush';
  if (/行书|草书|xing|running|cursive/.test(key)) return 'xing';
  if (/毛笔|书法|brush|calligraph/.test(key)) return 'brush';
  if (/楷|kai/.test(key)) return 'kai';
  if (/宋|明|song|serif|ming/.test(key)) return 'song';
  return 'hei';
}

// 给一段文字配字体：返回 { fonts, kind, label, handwriting, missing, substituted }。
// fonts[0] 是主字体，后面是补字用的；missing 是哪个字体都没有的字。
export async function resolveFonts(kindValue, text) {
  const kind = normalizeFontKind(kindValue);
  const spec = FONT_KINDS[kind];
  let main = null;
  let mainKind = '';
  for (const candidate of spec.chain) {
    main = await openKind(candidate);
    if (main) {
      mainKind = candidate;
      break;
    }
  }
  const fonts = main ? [main] : [];
  for (const candidate of FALLBACK_ORDER) {
    if (candidate === mainKind) continue;
    const font = await openKind(candidate);
    if (font && !fonts.includes(font)) fonts.push(font);
  }
  if (!fonts.length) return { fonts, kind, label: spec.label, handwriting: false, missing: [], substituted: [] };
  const wanted = String(text || '') + probeChars() + '﹁﹂﹃﹄「」『』';
  for (const font of fonts) await font.prepare(wanted);
  const missing = [];
  const substituted = [];
  for (const ch of new Set(Array.from(String(text || '')))) {
    if (/\s/.test(ch)) continue;
    const cp = ch.codePointAt(0);
    if (fonts[0].glyphId(cp)) continue;
    if (fonts.some((font) => font.glyphId(cp))) substituted.push(ch);
    else missing.push(ch);
  }
  return {
    fonts,
    kind: mainKind || kind,
    label: fonts[0].label || fonts[0].family,
    handwriting: Boolean(FONT_KINDS[mainKind] && FONT_KINDS[mainKind].handwriting),
    missing,
    substituted,
  };
}
