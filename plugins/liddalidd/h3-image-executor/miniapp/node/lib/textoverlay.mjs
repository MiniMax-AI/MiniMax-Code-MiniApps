// 程序排字：生图模型写长段文字、竖排、书法时很容易写错、漏字、编字（真机 20261113-01b902：
// 324 字的《兰亭集序》长卷，第一轮的候选有臆造字，交付的那张漏了 36 个字，评审看不清只能判「拿不准」放行）。
// 兜底做法是让模型只画一张不带字的底图（纸面、招牌、海报底板留空），再由程序用字体把原文逐字排进去。
//
// 步骤（每个文字层各做一遍）：
// 1. 找空白：在规划给的位置附近找一块颜色均匀、没有笔画和纹样的区域（底图上的空白纸面）。
//    模型不一定照着位置留空，所以以规划的位置为准、和实际空白求交；交出来太小或者区域里有字迹，就判不通过重画。
// 2. 配字体、排版：按规划的书体选字体（缺字时逐字用别的字体补），横排自动换行、竖排从右往左分列，取排得下的最大字号。
// 3. 合成：深色字按「墨落在纸上」的方式叠（跟着纸面原来的明暗和纹理走），浅色字直接盖上；
//    毛笔字加一点墨色浓淡和边缘洇开，免得像贴上去的。
// 4. 按原格式编码成最终文件（JPEG 用高质量 93，和换二维码一致）。
import { layoutText, drawGlyphs, drawGlyphsSplit, glyphCount, glyphRects, isPunct, probeSplit, splittableChar } from './textlayout.mjs';
import { resolveFonts, normalizeFontKind, FONT_KINDS } from './fonts.mjs';
import { encodePng } from './png.mjs';
import { encodeJpeg } from './jpegenc.mjs';

const JPEG_QUALITY = 93;
// 找空白用的工作分辨率（长边）。
const WORK_EDGE = 768;
// 规划的位置和实际空白求交后，至少还要剩这么多（占规划面积的比例）。
const MIN_COVERAGE = 0.55;
// 排进去的字至少这么大（占图片短边的比例），再小就不算「每个字都能认」。
const MIN_SIZE_RATIO = 0.008;
const MIN_SIZE_PX = 14;

export const TEXT_REASONS = {
  not_blank: '底图上预留给文字的地方没有留空',
  marks: '底图上预留给文字的地方已经有字迹或印章',
  too_small: '预留的空白太小，排不下全部文字',
  overlap: '两段文字排到了一起',
  no_font: '找不到可用的字体',
  missing_glyphs: '字体里缺字',
  empty: '没有要排的文字',
  error: '排字出错',
};

const tick = () => new Promise((resolve) => setImmediate(resolve));

// ---------------------------------------------------------------- 对外入口

// 在已解码的图上排字，返回最终文件的字节。layers：[{ text, box:[左,上,右,下], direction, font, color, align, punctuation, role }]。
// 返回 { ok, buffer, format, image, results }；有一层没排成就整体不通过，buffer 为 null（排了一半的图不交付）。
// 先每层各自找空白、排版（别的层的规划位置和已经排好的字都算占用，一层字不会挪到别的层上去），
// 再把同一角色（正文、脚注、标题……）的字号统一成其中最小的，然后查一遍有没有两层字叠在一起，最后才画。
// 一层一层各取「排得下的最大字号」的话，两段正文一个 118、一个 128 像素（真机 20261116-41535c 的课本页）。
export async function overlayText(image, format, layers, options) {
  const opts = options || {};
  const startedAt = Date.now();
  const list = (Array.isArray(layers) ? layers : []).filter((layer) => layer && String(layer.text || '').trim());
  if (!list.length) return { ok: false, buffer: null, format, image, results: [], ms: 0 };
  const out = { ...image, data: Buffer.from(image.data) };
  const work = analysisImage(image);
  const plannedBoxes = list.map((layer) => boxToPixels(layer.box, image.width, image.height));
  const seeds = surfaceSeeds(work, list, plannedBoxes);
  const prepared = [];
  const placed = [];
  for (let i = 0; i < list.length; i += 1) {
    const blocked = [...plannedBoxes.filter((_, j) => j !== i).map((box) => ({ ...box, own: true })), ...placed];
    let item;
    try {
      item = await prepareLayer(work, image, list[i], opts, { planned: plannedBoxes[i], seed: seeds[i], blocked });
    } catch (error) {
      item = { result: failure(list[i], 'error', String((error && error.message) || error)) };
    }
    if (item.layout) {
      const pad = item.layout.size * 0.08;
      for (const rect of glyphRects(item.layout.glyphs)) placed.push({ x: rect.x0 - pad, y: rect.y0 - pad, w: rect.x1 - rect.x0 + 2 * pad, h: rect.y1 - rect.y0 + 2 * pad });
    }
    prepared.push(item);
    await tick();
  }
  const caps = new Map();
  for (const item of prepared) {
    if (!item.layout || !item.role) continue;
    caps.set(item.role, Math.min(caps.has(item.role) ? caps.get(item.role) : Infinity, item.layout.size));
  }
  // 层级：脚注、页码、图注不能比正文大。规划给的框太高时，按框取的最大字号会让页码比正文还大一号。
  const body = caps.get('body');
  if (body) for (const role of ['footnote', 'page', 'caption']) if (caps.has(role)) caps.set(role, Math.min(caps.get(role), body * 0.82));
  for (const item of prepared) {
    if (!item.layout || !item.role) continue;
    const cap = caps.get(item.role);
    if (cap < item.layout.size - 0.5) {
      const again = layoutText(item.fontInfo.fonts, item.text, item.box, { ...item.layoutOptions, maxSize: cap });
      if (again.fits) {
        item.layout = again;
        item.unified = true;
      }
    }
  }
  // 两层字叠在一起就不交付：以前每层各找各的空白，两段字可以排进同一块地方（真机 20261116-06a562，
  // 页眉和脚注叠在一起又压在矩阵上，评审只给了质量分，照样交付）。
  const rects = prepared.map((item) => (item.layout ? glyphRects(item.layout.glyphs) : []));
  prepared.forEach((item, i) => {
    if (!item.layout) return;
    const hit = prepared.findIndex((other, j) => j < i && other.layout && rectsOverlap(rects[i], rects[j]));
    if (hit < 0) return;
    item.result = { ...failure(item.layer, 'overlap', '和「' + shortText(prepared[hit].text, 12) + '」叠在一起'), ...item.base, box: normalizedBox(item.box, image) };
    item.layout = null;
  });
  prepared.forEach((item, i) => {
    item.others = item.layout ? rects.filter((_, j) => j !== i && prepared[j].layout).flat() : [];
  });
  const results = [];
  for (const item of prepared) {
    if (!item.layout) {
      results.push(item.result);
      continue;
    }
    try {
      results.push(drawLayer(out, image, item));
    } catch (error) {
      results.push({ ...failure(item.layer, 'error', String((error && error.message) || error)), ...item.base });
    }
    await tick();
  }
  const ok = results.every((item) => item.ok);
  if (!ok) return { ok, buffer: null, format, image, results, ms: Date.now() - startedAt };
  const outFormat = format === 'png' ? 'png' : 'jpeg';
  const buffer = outFormat === 'png' ? encodePng(out, { level: 6 }) : encodeJpeg(out, { quality: JPEG_QUALITY });
  return { ok, buffer, format: outFormat, image: out, results, ms: Date.now() - startedAt };
}

// 两组字形矩形有没有交叠。各往里收一点：上标贴着前一个字、拼音贴着汉字这类紧挨着的不算。
function rectsOverlap(a, b) {
  for (const p of a) {
    const sp = Math.min(p.x1 - p.x0, p.y1 - p.y0) * 0.12;
    for (const q of b) {
      const sq = Math.min(q.x1 - q.x0, q.y1 - q.y0) * 0.12;
      if (p.x0 + sp < q.x1 - sq && q.x0 + sq < p.x1 - sp && p.y0 + sp < q.y1 - sq && q.y0 + sq < p.y1 - sp) return true;
    }
  }
  return false;
}

function shortText(value, n) {
  const chars = Array.from(String(value || '').replace(/\s+/g, ' ').trim());
  return chars.length > n ? chars.slice(0, n).join('') + '…' : chars.join('');
}

// 同一块载体（规划写的 surface 相同）上的几层字，某一层的规划位置整个落在载体外面时
// （页眉的框画在了桌面上：模型把整页画小了一圈，四周露出桌面），这一层找空白时改用同组大多数层的样本。
// 不换的话它会把桌面当成空白，字排到页面外面去。只换亮度和大多数差得很远的（桌面对纸面），
// 纸面上的浅色色块和纸面差得不多，不换：规划写在色块里的字照旧排在色块里。
function surfaceSeeds(work, layers, boxes) {
  const own = boxes.map((box) => pickSeed(work, box));
  const out = new Array(layers.length).fill(null);
  const groups = new Map();
  layers.forEach((layer, i) => {
    const key = String(layer.surface || '').trim();
    if (!key || !own[i]) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  });
  for (const members of groups.values()) {
    if (members.length < 3) continue;
    let center = members[0];
    let best = -1;
    for (const i of members) {
      const count = members.filter((j) => Math.abs(own[j].lum - own[i].lum) <= 60).length;
      if (count > best) {
        best = count;
        center = i;
      }
    }
    if (best < Math.max(2, Math.ceil(members.length * 0.6))) continue;
    for (const i of members) if (Math.abs(own[i].lum - own[center].lum) > 60) out[i] = own[center];
  }
  return out;
}

const ROLES = new Set(['title', 'subtitle', 'body', 'footnote', 'caption', 'label', 'page', 'pinyin']);

// 统一字号按什么分组。规划写了 role 就按 role；没写的老会话，横排的长段落按「字体 + 颜色」分组：
// 黑色宋体的几段正文是一组，灰色的脚注是另一组，不会被拉成一样大。
function roleOf(layer, text, direction) {
  const role = String(layer.role || '').trim().toLowerCase();
  if (ROLES.has(role)) return role;
  if (direction !== 'horizontal' || glyphCount(text) < 30) return '';
  return 'auto:' + normalizeFontKind(layer.font) + ':' + String(layer.color || '').toLowerCase();
}

// 首尾只去半角空白和换行：段首的全角空格是缩进，以前一个 trim() 就把它删了。
function cleanText(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/^[ \t\n\f\v\u00a0]+/, '')
    .replace(/[\s\u3000]+$/, '');
}

// 正文段落首行空两格。规划写了「　　」就照它的，没写才补；拉丁字母开头的段落（英文）不补。
function indentParagraphs(text, count) {
  if (!(count > 0)) return text;
  return text
    .split('\n')
    .map((line) => (!line || line.startsWith('\u3000') || /^[A-Za-z0-9]/.test(line) ? line : '\u3000'.repeat(count) + line))
    .join('\n');
}

function failure(layer, reason, detail) {
  return {
    text: String(layer.text || ''),
    ok: false,
    reason,
    reasonText: TEXT_REASONS[reason] || reason,
    detail: detail || '',
  };
}

// 部件分色：part = { side: left / right / top / bottom, color }，这一层每个汉字靠 side 那一侧的部件用 part.color，
// 其余用这一层的 color。规划写的方向词中英文都认。
const PART_SIDE_WORDS = { left: 'left', right: 'right', top: 'top', bottom: 'bottom', 左: 'left', 右: 'right', 上: 'top', 下: 'bottom', 左边: 'left', 右边: 'right', 上边: 'top', 下边: 'bottom', 上面: 'top', 下面: 'bottom' };

export function normalizePart(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const side = PART_SIDE_WORDS[String(raw.side || '').trim().toLowerCase()] || '';
  const color = String(raw.color || '').trim();
  if (!side || !/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(color)) return null;
  return { side, color: color.startsWith('#') ? color : '#' + color };
}

// 切线一行都没碰到笔画最好；碰到的不超过 2% 算干净，不超过 6% 还能用（笔画中间换色，近看看得出来）。
const PART_CLEAN_CUT = 0.02;
const PART_MAX_CUT = 0.06;

// 给要分色的一层挑字体：先试规划要的字体，切不干净再试宋体、黑体。毛笔字常把偏旁和右边连成一笔，
// 「楷体」在没有楷体字体的机器上也会落到毛笔字（见 fonts.mjs）。都切不开就整字一种颜色，照实写进结果。
async function choosePartFonts(kind, text, side, current, opts) {
  const chars = [...new Set(Array.from(text).filter((ch) => splittableChar(ch)))];
  if (!chars.length) return { fontInfo: current, ok: false, note: '这一层没有可以分色的汉字' };
  const resolve = opts.resolveFonts || resolveFonts;
  const tried = [];
  let best = null;
  let firstBad = '';
  for (const candidate of [kind, 'song', 'hei']) {
    const info = candidate === kind ? current : await resolve(candidate, text);
    if (!info.fonts.length || info.missing.length) continue;
    if (tried.some((item) => item.label === info.label)) continue;
    let worst = 0;
    let bad = '';
    for (const ch of chars) {
      const font = info.fonts.find((item) => item.glyphId(ch.codePointAt(0)));
      const probe = font ? probeSplit(font, ch, side) : { ok: false };
      if (!probe.ok) {
        bad = ch;
        break;
      }
      worst = Math.max(worst, probe.cut);
    }
    tried.push({ label: info.label, bad, worst });
    if (bad) {
      firstBad = firstBad || bad;
      continue;
    }
    if (worst <= PART_CLEAN_CUT) return { fontInfo: info, ok: true, worst, note: switchNote(tried, info, current) };
    if (!best || worst < best.worst) best = { info, worst };
  }
  if (best && best.worst <= PART_MAX_CUT) return { fontInfo: best.info, ok: true, worst: best.worst, note: switchNote(tried, best.info, current) };
  return {
    fontInfo: current,
    ok: false,
    note: '「' + (firstBad || chars.join('')) + '」在可用的字体里' + SIDE_LABELS[side] + '的部件和其余部分连在一起，分不开颜色，整字用一种颜色',
  };
}

const SIDE_LABELS = { left: '左边', right: '右边', top: '上边', bottom: '下边' };

function switchNote(tried, chosen, current) {
  if (chosen.label === current.label) return '';
  const first = tried.find((item) => item.label === current.label);
  const why = !first ? '分不了色' : first.bad ? '「' + first.bad + '」分不开部件' : '分色要切断笔画';
  return current.label + '里' + why + '，这一层改用' + chosen.label;
}

// 第一遍：配字体、找空白、按这一层自己的框排出能排下的最大字号。失败时返回 { result }，成功时带上排版结果。
// ctx：planned（规划位置，像素）、seed（同一块载体上别的层的样本，见 surfaceSeeds）、blocked（别的层占着的地方）。
async function prepareLayer(work, original, layer, opts, ctx) {
  const context = ctx || {};
  const direction = layer.direction === 'vertical' ? 'vertical' : 'horizontal';
  const raw = cleanText(layer.text);
  if (!raw.trim()) return { result: failure(layer, 'empty') };
  const role = roleOf(layer, raw, direction);
  const indent = direction === 'horizontal' && String(layer.role || '').toLowerCase() === 'body' ? clampInt(layer.indent === undefined || layer.indent === null ? 2 : Number(layer.indent), 0, 4) : 0;
  const text = indentParagraphs(raw, indent);
  const kind = normalizeFontKind(layer.font);
  let fontInfo = await (opts.resolveFonts || resolveFonts)(kind, text);
  if (!fontInfo.fonts.length) return { result: failure(layer, 'no_font') };
  if (fontInfo.missing.length) return { result: failure(layer, 'missing_glyphs', fontInfo.missing.slice(0, 12).join('')) };
  const wantPart = normalizePart(layer.part);
  let part = null;
  if (wantPart) {
    const chosen = await choosePartFonts(kind, text, wantPart.side, fontInfo, opts);
    fontInfo = chosen.fontInfo;
    part = { ...wantPart, ok: chosen.ok, note: chosen.note || '', font: fontInfo.label };
  }

  const planned = context.planned || boxToPixels(layer.box, original.width, original.height);
  const region = findTextRegion(work, planned, original, { seed: context.seed, blocked: context.blocked, nudge: true });
  const base = {
    text: text.trim(),
    kind: fontInfo.kind,
    font: fontInfo.label,
    planned: normalizedBox(planned, original),
    blank: region.blank ? normalizedBox(region.blank, original) : null,
    coverage: round(region.coverage, 3),
    marks: round(region.marks, 4),
    role,
    // 规划位置不空、就近上下挪过的距离（占画面高度的比例，正数是往下）。
    moved: region.ok && region.moved ? round(region.moved / original.height, 4) : 0,
    surfaceSeed: Boolean(context.seed),
  };
  if (!region.ok) return { result: { ...failure(layer, region.reason, region.detail), ...base } };
  const box = region.box;
  const minSize = Math.max(MIN_SIZE_PX, Math.min(original.width, original.height) * MIN_SIZE_RATIO);
  const layoutOptions = {
    direction,
    align: layer.align,
    valign: layer.valign,
    punctuation: layer.punctuation || (direction === 'vertical' ? 'inline' : undefined),
    handwriting: fontInfo.handwriting,
    minSize,
    maxSize: layer.maxSize || undefined,
    lineSpacing: layer.lineSpacing,
    letterSpacing: layer.letterSpacing,
    // 正文、脚注（以及老会话里推断出来的长段落）两端对齐。
    justify: role === 'body' || role === 'footnote' || role.startsWith('auto:'),
  };
  let layout = layoutText(fontInfo.fonts, text, box, layoutOptions);
  // 标题、标签、示例词这类短文字默认排一行：程序取能放下的最大字号，框高一点就会把「清水」排成上下两行、
  // 把「＋ 青 ＝」的「＝」挤到下一行（真机 20261117-f57a0f）。只有排一行时字号比排几行小太多（不到六成）才换行。
  if (ONE_LINE_ROLES.has(role) && direction === 'horizontal' && layout.fits && layout.lines > 1 && !text.includes('\n')) {
    const one = layoutText(fontInfo.fonts, text, box, { ...layoutOptions, maxLines: 1 });
    if (one.fits && one.size >= layout.size * 0.6) {
      layout = one;
      layoutOptions.maxLines = 1;
    }
  }
  if (!layout.fits) {
    return {
      result: {
        ...failure(layer, 'too_small', '能排下的最大字号 ' + Math.round(layout.size || 0) + 'px，低于 ' + Math.round(minSize) + 'px'),
        ...base,
        box: normalizedBox(box, original),
      },
    };
  }
  return { layer, text, role, indent, direction, fontInfo, region, box, layoutOptions, layout, base, unified: false, part };
}

const ONE_LINE_ROLES = new Set(['title', 'subtitle', 'label', 'caption', 'page', 'pinyin']);

// 第二遍：定颜色、画字。脚注层先在字的上方画一条短分隔线（课本、书刊的脚注都和正文隔开），
// 空白的上沿离字太近、画不下线的，把字往下挪一点再排。
function drawLayer(out, original, item) {
  const { layer, region, fontInfo, direction } = item;
  let { layout, box } = item;
  const ink = resolveInk(layer.color, region.seed);
  let rule = null;
  if (item.role === 'footnote' && direction === 'horizontal' && layer.rule !== false) {
    const thick = Math.max(2, Math.round(Math.min(original.width, original.height) * 0.0011));
    const gap = Math.max(thick * 3, layout.size * 0.5);
    const blankTop = region.blank ? region.blank.y : box.y;
    let y = layout.top - gap;
    if (y - thick < blankTop + 2) {
      const need = Math.ceil(blankTop + 2 + thick - y);
      const lowered = { ...box, y: box.y + need, h: box.h - need };
      const again = lowered.h > 0 ? layoutText(fontInfo.fonts, item.text, lowered, { ...item.layoutOptions, maxSize: layout.size }) : null;
      if (again && again.fits) {
        layout = again;
        box = lowered;
        y = layout.top - gap;
      } else {
        y = null;
      }
    }
    if (y !== null) rule = { x: box.x, y, w: box.w * 0.28, h: thick };
    // 线会碰到别的层的字就不画：真机 20261116-06a562 脚注被挪到正文中间，分隔线横穿了矩阵。
    if (rule) {
      const reach = thick * 3;
      const hit = (item.others || []).some((r) => r.x0 < rule.x + rule.w && r.x1 > rule.x && r.y0 < rule.y + reach && r.y1 > rule.y - reach);
      if (hit) rule = null;
    }
  }
  // 蒙版比排版框大一圈：字旁的小标点、手写抖动会出框一点。
  const margin = Math.ceil(layout.size * 0.8) + 4;
  const mx0 = Math.max(0, Math.floor(box.x - margin));
  const my0 = Math.max(0, Math.floor(Math.min(box.y, rule ? rule.y - rule.h : box.y) - margin));
  const mx1 = Math.min(out.width, Math.ceil(box.x + box.w + margin));
  const my1 = Math.min(out.height, Math.ceil(box.y + box.h + margin));
  const mask = { x: mx0, y: my0, w: mx1 - mx0, h: my1 - my0, data: new Float32Array((mx1 - mx0) * (my1 - my0)) };
  // 部件分色：偏旁那一侧画进另一张蒙版，各自上色。
  const partInk = item.part && item.part.ok ? resolveInk(item.part.color, region.seed) : null;
  const partMask = partInk ? { ...mask, data: new Float32Array(mask.data.length) } : null;
  const partReport = partMask ? drawGlyphsSplit(mask, partMask, layout.glyphs, item.part.side) : null;
  if (!partMask) drawGlyphs(mask, layout.glyphs);
  if (rule) fillRule(mask, rule);
  finishMask(mask, layout.size, fontInfo.handwriting, original);
  blend(out, mask, ink, region.seed);
  if (partMask) {
    finishMask(partMask, layout.size, fontInfo.handwriting, original);
    blend(out, partMask, partInk, region.seed);
  }
  const part = item.part
    ? {
        side: item.part.side,
        color: partInk ? toHex(partInk.rgb) : item.part.color,
        ok: Boolean(partReport && partReport.split && !partReport.failed.length),
        split: partReport ? partReport.split : 0,
        failed: partReport ? partReport.failed.join('') : '',
        cut: partReport ? round(partReport.maxCut, 3) : 0,
        font: item.part.font,
        note: item.part.ok
          ? partReport && partReport.failed.length
            ? '「' + partReport.failed.join('') + '」分不开部件，整字用一种颜色'
            : item.part.note
          : item.part.note,
      }
    : null;
  return {
    ...item.base,
    ok: true,
    reason: '',
    reasonText: '',
    detail: '',
    box: normalizedBox(box, original),
    direction,
    punctuation: direction === 'vertical' ? layer.punctuation || 'inline' : 'inline',
    size: Math.round(layout.size),
    rows: layout.rows,
    cols: layout.cols,
    lines: layout.lines,
    glyphs: layout.glyphs.length,
    chars: glyphCount(item.text),
    dropped: layout.dropped.length,
    substituted: fontInfo.substituted.join(''),
    color: toHex(ink.rgb),
    autoColor: ink.auto,
    blend: ink.mode,
    indent: item.indent,
    unified: Boolean(item.unified),
    superscripts: layout.superscripts || 0,
    rule: Boolean(rule),
    ...(part ? { part } : {}),
  };
}

// 分隔线：一条实心横线，上下边缘按覆盖面积抗锯齿，和字一起进蒙版、一起上色。
function fillRule(mask, rule) {
  const y0 = rule.y - rule.h / 2;
  const y1 = rule.y + rule.h / 2;
  for (let y = Math.floor(y0); y < Math.ceil(y1); y += 1) {
    const my = y - mask.y;
    if (my < 0 || my >= mask.h) continue;
    const cover = Math.max(0, Math.min(y1, y + 1) - Math.max(y0, y));
    for (let x = Math.floor(rule.x); x < Math.ceil(rule.x + rule.w); x += 1) {
      const mx = x - mask.x;
      if (mx < 0 || mx >= mask.w) continue;
      const cx = Math.max(0, Math.min(rule.x + rule.w, x + 1) - Math.max(rule.x, x));
      const at = my * mask.w + mx;
      mask.data[at] = Math.max(mask.data[at], cover * cx);
    }
  }
}

// ---------------------------------------------------------------- 位置

// 规划写的 [左, 上, 右, 下]（0-1 的画面比例）换成像素框。缺了、写错了（退化成一条线）才用居中 80% 的框。
function boxToPixels(raw, width, height) {
  let box = Array.isArray(raw) && raw.length === 4 ? raw.map(Number) : null;
  if (!box || box.some((value) => !Number.isFinite(value))) box = [0.1, 0.1, 0.9, 0.9];
  // 写成百分数的（[6, 14, 94, 86]）也认。
  if (box.some((value) => value > 1.5)) box = box.map((value) => value / 100);
  let [left, top, right, bottom] = box.map((value) => Math.min(1, Math.max(0, value)));
  if (right < left) [left, right] = [right, left];
  if (bottom < top) [top, bottom] = [bottom, top];
  if (right - left < 0.002 || bottom - top < 0.002) [left, top, right, bottom] = [0.1, 0.1, 0.9, 0.9];
  // 单行的页眉、脚注、页码本来就矮（4K 竖图上 1.8% 也有 85 像素）：保留位置，只把太窄的一边按中线撑到 2%。
  // 以前直接换成居中 80% 的框，页眉和脚注就被排进了页面正中，叠在一起又压在正文上（真机 20261116-06a562）。
  [left, right] = widen(left, right, 0.02);
  [top, bottom] = widen(top, bottom, 0.02);
  return { x: left * width, y: top * height, w: (right - left) * width, h: (bottom - top) * height };
}

function widen(a, b, min) {
  if (b - a >= min) return [a, b];
  let lo = (a + b) / 2 - min / 2;
  let hi = lo + min;
  if (lo < 0) [lo, hi] = [0, min];
  if (hi > 1) [lo, hi] = [1 - min, 1];
  return [lo, hi];
}

function normalizedBox(box, image) {
  return [box.x / image.width, box.y / image.height, (box.x + box.w) / image.width, (box.y + box.h) / image.height].map((value) => round(value, 4));
}

// 找空白的工作图：按整数倍块平均缩小，记下每个点的颜色、亮度和梯度。
function analysisImage(image) {
  const factor = Math.max(1, Math.ceil(Math.max(image.width, image.height) / WORK_EDGE));
  const w = Math.max(1, Math.floor(image.width / factor));
  const h = Math.max(1, Math.floor(image.height / factor));
  const r = new Float32Array(w * h);
  const g = new Float32Array(w * h);
  const b = new Float32Array(w * h);
  const { data, channels } = image;
  const area = factor * factor;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      for (let yy = 0; yy < factor; yy += 1) {
        let i = ((y * factor + yy) * image.width + x * factor) * channels;
        for (let xx = 0; xx < factor; xx += 1, i += channels) {
          if (channels >= 3) {
            sr += data[i];
            sg += data[i + 1];
            sb += data[i + 2];
          } else {
            sr += data[i];
            sg += data[i];
            sb += data[i];
          }
        }
      }
      const at = y * w + x;
      r[at] = sr / area;
      g[at] = sg / area;
      b[at] = sb / area;
    }
  }
  const lum = new Float32Array(w * h);
  for (let i = 0; i < lum.length; i += 1) lum[i] = 0.299 * r[i] + 0.587 * g[i] + 0.114 * b[i];
  const grad = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const at = y * w + x;
      grad[at] = Math.abs(lum[at + 1] - lum[at - 1]) + Math.abs(lum[at + w] - lum[at - w]);
    }
  }
  // 大范围模糊后的颜色当作「这一带的底色」（见 carrierBackground）：纸面从中间到边缘的明暗渐变不算笔画，
  // 只有和这一带底色明显不一样的点才算有东西。
  const radius = Math.max(4, Math.round(Math.max(w, h) * 0.03));
  return { w, h, factor, r, g, b, lum, grad, radius };
}

function boxBlur(src, w, h, radius) {
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y += 1) {
    let row = 0;
    for (let x = 0; x < w; x += 1) {
      row += src[y * w + x];
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const ya = Math.max(0, y - radius);
    const yb = Math.min(h, y + radius + 1);
    for (let x = 0; x < w; x += 1) {
      const xa = Math.max(0, x - radius);
      const xb = Math.min(w, x + radius + 1);
      const sum = integral[yb * (w + 1) + xb] - integral[ya * (w + 1) + xb] - integral[yb * (w + 1) + xa] + integral[ya * (w + 1) + xa];
      out[y * w + x] = sum / ((xb - xa) * (yb - ya));
    }
  }
  return out;
}

// 只拿「和样本同一块载体」的点求这一带的底色（按掩码加权的大范围模糊）。直接整片模糊会把旁边的深色背景、
// 画面内容混进来：窄的横幅、招牌、标签条整条都被判成「和底色差得远」，25% 高的空白横幅都排不上字。
// member：每个点（做过 3×3 平滑）的颜色离样本不超过 tolRegion，算作同一块载体；笔画、印章本身不在里面，
// 也就不会把底色拉偏。
function carrierBackground(work, seed, tolRegion) {
  const { w, h } = work;
  const n = w * h;
  const sr = boxBlur(work.r, w, h, 1);
  const sg = boxBlur(work.g, w, h, 1);
  const sb = boxBlur(work.b, w, h, 1);
  const member = new Float32Array(n);
  const mr = new Float32Array(n);
  const mg = new Float32Array(n);
  const mb = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const inside = Math.max(Math.abs(sr[i] - seed.r), Math.abs(sg[i] - seed.g), Math.abs(sb[i] - seed.b)) <= tolRegion;
    if (!inside) continue;
    member[i] = 1;
    mr[i] = work.r[i];
    mg[i] = work.g[i];
    mb[i] = work.b[i];
  }
  const weight = boxBlur(member, w, h, work.radius);
  const br = boxBlur(mr, w, h, work.radius);
  const bg = boxBlur(mg, w, h, work.radius);
  const bb = boxBlur(mb, w, h, work.radius);
  for (let i = 0; i < n; i += 1) {
    const wt = weight[i];
    if (wt > 1e-3) {
      br[i] /= wt;
      bg[i] /= wt;
      bb[i] /= wt;
    } else {
      br[i] = sr[i];
      bg[i] = sg[i];
      bb[i] = sb[i];
    }
  }
  return { member, br, bg, bb };
}

function carrierDistance(work, carrier, i) {
  return Math.max(Math.abs(work.r[i] - carrier.br[i]), Math.abs(work.g[i] - carrier.bg[i]), Math.abs(work.b[i] - carrier.bb[i]));
}

// 规划位置换成工作图坐标。
function workRect(work, box) {
  const f = work.factor;
  return {
    x0: clampInt(Math.round(box.x / f), 0, work.w - 1),
    y0: clampInt(Math.round(box.y / f), 0, work.h - 1),
    x1: clampInt(Math.round((box.x + box.w) / f), 1, work.w),
    y1: clampInt(Math.round((box.y + box.h) / f), 1, work.h),
  };
}

// 取样：把规划框内缩一圈分成 3×3 块，取纹理最平的一块当「空白长什么样」的样本。
// 不直接取中心：规划框正中可能恰好被模型放了别的东西。
function pickSeed(work, planned) {
  const p = workRect(work, planned);
  const inset = 0.12;
  const sx0 = p.x0 + (p.x1 - p.x0) * inset;
  const sy0 = p.y0 + (p.y1 - p.y0) * inset;
  const sw = (p.x1 - p.x0) * (1 - 2 * inset);
  const sh = (p.y1 - p.y0) * (1 - 2 * inset);
  let seed = null;
  for (let gy = 0; gy < 3; gy += 1) {
    for (let gx = 0; gx < 3; gx += 1) {
      const bx0 = Math.floor(sx0 + (sw * gx) / 3);
      const by0 = Math.floor(sy0 + (sh * gy) / 3);
      const bx1 = Math.max(bx0 + 1, Math.floor(sx0 + (sw * (gx + 1)) / 3));
      const by1 = Math.max(by0 + 1, Math.floor(sy0 + (sh * (gy + 1)) / 3));
      const stats = blockStats(work, bx0, by0, bx1, by1);
      if (!stats) continue;
      const centerPenalty = gx === 1 && gy === 1 ? 0 : 0.15;
      const score = stats.grad + stats.mad * 0.5 + centerPenalty;
      if (!seed || score < seed.score) seed = { ...stats, score, block: [bx0, by0, bx1, by1] };
    }
  }
  return seed;
}

// 规划位置不空时，就近上下挪的距离（像素）：先近后远，最远两个框高，但不超过画面高度的 6%。
// 模型画的分隔线、色块边缘常常和规划差一点（真机 20261116-06a562：标题框压着模型画在 9% 处的横线），
// 往下挪半行就是空白；挪得太远就不是规划的版面了。
function nudgeOffsets(planned, image) {
  const step = Math.max(planned.h * 0.25, image.height * 0.004);
  const limit = Math.min(Math.max(planned.h * 2, image.height * 0.03), image.height * 0.06);
  const out = [];
  for (let d = step; d <= limit + 1e-6; d += step) out.push(d, -d);
  return out;
}

// 在规划位置附近找空白。返回 { ok, box（排字框，像素）, blank（找到的空白，像素）, seed, coverage, marks, moved, reason }。
// options.seed：用同一块载体上别的文字层的样本（这一层的规划位置整个落在载体外面时，见 surfaceSeeds）；
// options.blocked：别的文字层占着的地方（它们的规划位置、已经排好的字，像素框），不算空白——
// 一层字不能长到、挪到别的层上去。own：true 的框只挡挪动之后的位置，不挡这一层自己的规划位置
// （规划的两个框本来就有一点重叠时，不该因此判这一层没留空）；
// options.nudge：规划位置不空时就近上下挪（见 nudgeOffsets）。
function findTextRegion(work, planned, image, options) {
  const opts = options || {};
  const f = work.factor;
  const W = work.w;
  const H = work.h;
  const p = workRect(work, planned);
  const seed = opts.seed || pickSeed(work, planned);
  if (!seed) return { ok: false, reason: 'not_blank', detail: '规划的位置超出画面', coverage: 0, marks: 0, seed: null };
  const tolRegion = 42;
  const carrier = carrierBackground(work, seed, tolRegion);
  // 容差按样本自己的纹理定：宣纸的纤维、帘纹本身就有起伏（真机底图亮度偏差 99 分位到 18、梯度 99 分位到 32），
  // 按中位数定阈值会把正常纸纹当成笔画，整张空白纸判成「没留空」。墨迹的偏差在 100 以上，留出的余量足够分开。
  const local95 = blockPercentile(work, seed.block, (i) => carrierDistance(work, carrier, i), 0.95);
  const tolColor = clamp(Math.max(local95 * 2, seed.mad * 4) + 10, 22, 55);
  const tolGrad = clamp(seed.grad90 * 2.2, 30, 90);
  const blank = new Uint8Array(W * H);
  for (let i = 0; i < blank.length; i += 1) {
    blank[i] = carrier.member[i] && carrierDistance(work, carrier, i) <= tolColor && work.grad[i] <= tolGrad ? 1 : 0;
  }
  for (const block of opts.blocked || []) {
    const r = workRect(work, block);
    for (let y = r.y0; y < r.y1; y += 1) {
      for (let x = r.x0; x < r.x1; x += 1) {
        if (block.own && x >= p.x0 && x < p.x1 && y >= p.y0 && y < p.y1) continue;
        blank[y * W + x] = 0;
      }
    }
  }
  // 一个点算「空白」，要求它周围一小块里九成以上都是空白：纸纹、零星噪点放过，笔画、印章、纹样挡住。
  // 「一小块」不超过规划位置短边的五分之一：窄横幅只有十几个点高，按整张图定的窗口会把上下边各啃掉一大截。
  const plannedSide = Math.min(p.x1 - p.x0, p.y1 - p.y0);
  const k = Math.max(3, Math.min(Math.round(Math.max(W, H) * 0.012), Math.round(plannedSide * 0.2)));
  const dense = denseMask(blank, W, H, k, 0.9);
  const plannedArea = Math.max(1, planned.w * planned.h);

  const attempt = (target) => {
    const t = workRect(work, target);
    const grow = 0.2;
    const win = {
      x0: clampInt(Math.floor(t.x0 - (t.x1 - t.x0) * grow), 0, W),
      y0: clampInt(Math.floor(t.y0 - (t.y1 - t.y0) * grow), 0, H),
      x1: clampInt(Math.ceil(t.x1 + (t.x1 - t.x0) * grow), 0, W),
      y1: clampInt(Math.ceil(t.y1 + (t.y1 - t.y0) * grow), 0, H),
    };
    const rect = maxRectangle(dense, W, win);
    if (!rect.area) return { ok: false, reason: 'not_blank', detail: '规划位置附近没有一块空白', coverage: 0, marks: 0, seed };
    const blankPx = { x: rect.x0 * f, y: rect.y0 * f, w: (rect.x1 - rect.x0) * f, h: (rect.y1 - rect.y0) * f };
    // 排字框 = 规划位置 ∩ 空白内缩一圈：字贴着空白的边缘写，看起来像写出界了。内缩量按空白自己的大小封顶：
    // 按整张图的比例算，一条窄横幅上下各缩掉一大截，剩下的不够规划位置的一半，空白的横幅也会判成没留空。
    const side = Math.min(blankPx.w, blankPx.h);
    const pad = Math.round(Math.min(Math.max(Math.min(image.width, image.height) * 0.02, side * 0.035), side * 0.08));
    const inner = { x: blankPx.x + pad, y: blankPx.y + pad, w: blankPx.w - 2 * pad, h: blankPx.h - 2 * pad };
    const box = intersect(target, inner);
    const coverage = box ? (box.w * box.h) / plannedArea : 0;
    if (!box || coverage < MIN_COVERAGE) {
      return { ok: false, reason: 'not_blank', detail: '规划位置只有 ' + Math.round(coverage * 100) + '% 是空白', coverage, marks: 0, seed, blank: blankPx };
    }
    // 区域里零星的深色笔画（模型偷偷写的伪文字、小印章）不一定挡得住上面的九成规则，单独数一遍。
    const marks = markRatio(work, carrier, tolColor, box, f);
    if (marks > 0.006) {
      return {
        ok: false,
        reason: 'marks',
        detail: '排字区域里有 ' + (marks * 100).toFixed(1) + '% 的像素是明显的字迹或色块',
        coverage,
        marks,
        seed,
        blank: blankPx,
      };
    }
    return { ok: true, reason: '', box, blank: blankPx, seed, coverage, marks, moved: 0 };
  };

  const first = attempt(planned);
  // 图表的面板另有一套找法（chart.mjs 的 findSmoothPanel），不挪；排字时由调用方打开。
  if (first.ok || !opts.nudge) return first;
  for (const dy of nudgeOffsets(planned, image)) {
    const moved = { x: planned.x, y: planned.y + dy, w: planned.w, h: planned.h };
    if (moved.y < 0 || moved.y + moved.h > image.height) continue;
    const result = attempt(moved);
    if (result.ok) return { ...result, moved: dy };
  }
  return first;
}

function blockStats(work, x0, y0, x1, y1) {
  const W = work.w;
  const rs = [];
  const gs = [];
  const bs = [];
  const ls = [];
  const grads = [];
  for (let y = Math.max(0, y0); y < Math.min(work.h, y1); y += 1) {
    for (let x = Math.max(0, x0); x < Math.min(W, x1); x += 1) {
      const i = y * W + x;
      rs.push(work.r[i]);
      gs.push(work.g[i]);
      bs.push(work.b[i]);
      ls.push(work.lum[i]);
      grads.push(work.grad[i]);
    }
  }
  if (rs.length < 4) return null;
  const lum = median(ls);
  const devs = ls.map((value) => Math.abs(value - lum));
  return {
    r: median(rs),
    g: median(gs),
    b: median(bs),
    lum,
    grad: median(grads),
    grad90: percentile(grads, 0.9),
    mad: median(devs),
  };
}

function blockPercentile(work, block, measure, p) {
  const [x0, y0, x1, y1] = block;
  const values = [];
  for (let y = Math.max(0, y0); y < Math.min(work.h, y1); y += 1) {
    for (let x = Math.max(0, x0); x < Math.min(work.w, x1); x += 1) values.push(measure(y * work.w + x));
  }
  return percentile(values, p);
}

function denseMask(mask, W, H, k, ratio) {
  const integral = new Uint32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y += 1) {
    let row = 0;
    for (let x = 0; x < W; x += 1) {
      row += mask[y * W + x];
      integral[(y + 1) * (W + 1) + x + 1] = integral[y * (W + 1) + x + 1] + row;
    }
  }
  const half = Math.floor(k / 2);
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y += 1) {
    const ya = Math.max(0, y - half);
    const yb = Math.min(H, y + half + 1);
    for (let x = 0; x < W; x += 1) {
      // 看的是周围这一小块，不看这个点自己：单个噪点不该把整块空白切断（最大矩形要求全 1）。
      const xa = Math.max(0, x - half);
      const xb = Math.min(W, x + half + 1);
      const sum = integral[yb * (W + 1) + xb] - integral[ya * (W + 1) + xb] - integral[yb * (W + 1) + xa] + integral[ya * (W + 1) + xa];
      out[y * W + x] = sum >= ratio * (xb - xa) * (yb - ya) ? 1 : 0;
    }
  }
  return out;
}

// 二值图里面积最大的全 1 矩形（逐行直方图 + 单调栈），只在 win 范围里找。
function maxRectangle(mask, W, win) {
  const heights = new Int32Array(W);
  let best = { area: 0, x0: 0, y0: 0, x1: 0, y1: 0 };
  for (let y = win.y0; y < win.y1; y += 1) {
    for (let x = win.x0; x < win.x1; x += 1) heights[x] = mask[y * W + x] ? heights[x] + 1 : 0;
    const stackX = [];
    const stackH = [];
    for (let x = win.x0; x <= win.x1; x += 1) {
      const h = x < win.x1 ? heights[x] : 0;
      let start = x;
      while (stackH.length && stackH[stackH.length - 1] >= h) {
        const top = stackH.pop();
        const left = stackX.pop();
        const area = top * (x - left);
        if (area > best.area) best = { area, x0: left, x1: x, y0: y - top + 1, y1: y + 1 };
        start = left;
      }
      stackX.push(start);
      stackH.push(h);
    }
  }
  return best;
}

function markRatio(work, carrier, tolColor, box, f) {
  const x0 = Math.max(0, Math.floor(box.x / f));
  const y0 = Math.max(0, Math.floor(box.y / f));
  const x1 = Math.min(work.w, Math.ceil((box.x + box.w) / f));
  const y1 = Math.min(work.h, Math.ceil((box.y + box.h) / f));
  let count = 0;
  let total = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (carrierDistance(work, carrier, y * work.w + x) > tolColor * 1.8) count += 1;
      total += 1;
    }
  }
  return total ? count / total : 0;
}

// ---------------------------------------------------------------- 颜色与合成

function parseHex(value) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value || '').trim());
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

function toHex(rgb) {
  return '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

const lumOf = (rgb) => 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];

// 规划给的颜色和底色反差不够（比如浅米色纸上写米白字）时不照用，自动换成深墨或浅色字。
function resolveInk(color, seed) {
  const surface = [seed.r, seed.g, seed.b];
  const surfaceL = lumOf(surface);
  const want = parseHex(color);
  if (want && Math.abs(lumOf(want) - surfaceL) >= 70) {
    return { rgb: want, mode: lumOf(want) < surfaceL ? 'ink' : 'paint', auto: false };
  }
  if (surfaceL >= 120) return { rgb: [26, 24, 22], mode: 'ink', auto: true };
  return { rgb: [245, 242, 235], mode: 'paint', auto: true };
}

// 边缘稍微柔一点（照片本身不是矢量锐利的），毛笔字再加墨色浓淡。
function finishMask(mask, size, handwriting, image) {
  const big = Math.max(image.width, image.height) >= 2400;
  if (big) boxBlur3(mask);
  if (!handwriting) return;
  const cell = Math.max(3, Math.round(size * 0.06));
  const gw = Math.ceil(mask.w / cell) + 2;
  const gh = Math.ceil(mask.h / cell) + 2;
  const grid = new Float32Array(gw * gh);
  let state = 0x2545f491;
  for (let i = 0; i < grid.length; i += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    grid[i] = ((state >>> 0) % 1000) / 1000;
  }
  for (let y = 0; y < mask.h; y += 1) {
    const gy = y / cell;
    const iy = Math.floor(gy);
    const fy = gy - iy;
    for (let x = 0; x < mask.w; x += 1) {
      const at = y * mask.w + x;
      const a = mask.data[at];
      if (!a) continue;
      const gx = x / cell;
      const ix = Math.floor(gx);
      const fx = gx - ix;
      const n00 = grid[iy * gw + ix];
      const n10 = grid[iy * gw + ix + 1];
      const n01 = grid[(iy + 1) * gw + ix];
      const n11 = grid[(iy + 1) * gw + ix + 1];
      const n = (n00 * (1 - fx) + n10 * fx) * (1 - fy) + (n01 * (1 - fx) + n11 * fx) * fy;
      // 墨色浓淡：笔画中间最多淡 12%，边缘稍微加厚一点（墨在纸上会洇开）。
      const ink = 0.88 + 0.12 * n;
      const v = Math.min(1, Math.pow(a, 0.85) * ink * 1.02);
      mask.data[at] = v;
    }
  }
}

function boxBlur3(mask) {
  const { w, h, data } = mask;
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    for (let x = 0; x < w; x += 1) {
      const l = x > 0 ? data[row + x - 1] : data[row + x];
      const r = x < w - 1 ? data[row + x + 1] : data[row + x];
      tmp[row + x] = (l + data[row + x] * 2 + r) / 4;
    }
  }
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const at = y * w + x;
      const u = y > 0 ? tmp[at - w] : tmp[at];
      const d = y < h - 1 ? tmp[at + w] : tmp[at];
      data[at] = (u + tmp[at] * 2 + d) / 4;
    }
  }
}

// 深色字：结果 = 墨色 × 这一点的纸面亮度 / 纸面平均亮度，阴影、渐变、纸纹都留在字上。
// 浅色字（深底上写白字）：按同样的明暗比例调一下亮度，再盖上去。
function blend(out, mask, ink, seed) {
  const { data, channels, width } = out;
  const surface = [Math.max(1, seed.r), Math.max(1, seed.g), Math.max(1, seed.b)];
  for (let y = 0; y < mask.h; y += 1) {
    const iy = mask.y + y;
    for (let x = 0; x < mask.w; x += 1) {
      const a = mask.data[y * mask.w + x];
      if (a <= 0.002) continue;
      const i = (iy * width + mask.x + x) * channels;
      for (let c = 0; c < Math.min(3, channels); c += 1) {
        const base = data[i + c];
        const sc = channels >= 3 ? surface[c] : (surface[0] + surface[1] + surface[2]) / 3;
        const light = clamp(base / sc, 0.55, 1.35);
        const target = ink.mode === 'ink' ? ink.rgb[c] * light : clamp(ink.rgb[c] * (0.75 + 0.25 * light), 0, 255);
        data[i + c] = clamp(Math.round(base * (1 - a) + target * a), 0, 255);
      }
    }
  }
}

// ---------------------------------------------------------------- 给流水线用的小工具

// 程序画图表（chart.mjs）找空白用的是同一套办法：底图上预留的面板和预留给文字的纸面一样，要平整、没有笔迹。
export { analysisImage, boxToPixels, denseMask, findTextRegion as findBlankRegion, maxRectangle, normalizedBox };

// 一段文字有多难让模型直接画对：字多、竖排、书法这几样叠起来最容易残。
export function textRisk(layers) {
  const list = (Array.isArray(layers) ? layers : []).filter((layer) => layer && layer.text);
  const counts = list.map((layer) => glyphCount(String(layer.text).split('').filter((ch) => !isPunct(ch)).join('')));
  const total = counts.reduce((sum, n) => sum + n, 0);
  const longest = counts.length ? Math.max(...counts) : 0;
  const vertical = list.some((layer) => layer.direction === 'vertical');
  const brush = list.some((layer) => FONT_KINDS[normalizeFontKind(layer.font)].handwriting);
  const reasons = [];
  if (longest >= 24) reasons.push('单段 ' + longest + ' 个字');
  else if (total >= 40) reasons.push('合计 ' + total + ' 个字');
  if (list.length >= 6) reasons.push(list.length + ' 处文字');
  if (vertical && total >= 10) reasons.push('竖排');
  if (brush && total >= 12) reasons.push('书法字');
  return { total, longest, layers: list.length, high: reasons.length > 0, reasons };
}

function median(values) {
  return percentile(values, 0.5);
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
}

function intersect(a, b) {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function clampInt(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits) {
  const p = Math.pow(10, digits || 0);
  return Math.round((Number(value) || 0) * p) / p;
}
