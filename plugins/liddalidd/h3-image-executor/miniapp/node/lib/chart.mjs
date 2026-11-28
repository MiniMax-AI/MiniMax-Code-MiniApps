// 程序画图表。生图模型画柱状图、折线图、饼图时只会画「像图表的东西」：柱子高矮和数值对不上、刻度乱标、
// 数字写错。图里要放数据图表时，让模型只画一张留出空白面板的底图，坐标轴、刻度、网格、柱子、折线、扇形、
// 数字和图例都由程序按数据画上去，画完再从最终文件里量回来核对。
//
// 每张图表的步骤：
// 1. 找空白：和程序排字同一套办法（textoverlay.findBlankRegion），以规划的位置为准，和底图上实际的空白求交。
// 2. 定刻度：柱状图、条形图的数值轴一律从 0 起，不从 0 起柱子的高矮比例就是错的；刻度取 1、2、2.5、5 × 10ⁿ 的整齐间隔。
// 3. 排版：标题、图例、单位、刻度、类目先量好尺寸，剩下的是绘图区。放不下先整体缩字号，类目还放不下就斜着放。
// 4. 绘制：形状按面积精确抗锯齿（借用字形光栅化），文字用排字的字体，颜色跟着面板原来的明暗走。
// 5. 核对：从编码后的最终文件解码，先量出刻度线的位置、拟合出「数值 → 像素」，再按它检查每根柱子的端点、
//    每个数据点、每个扇形的边界是不是落在数值对应的位置。量出来对不上，这张图就不交付。
import { resolveFonts, normalizeFontKind } from './fonts.mjs';
import { drawGlyphs, placeMatrix, rasterizeGlyph } from './textlayout.mjs';
import { analysisImage, boxToPixels, denseMask, findBlankRegion, maxRectangle, normalizedBox } from './textoverlay.mjs';
import { encodePng } from './png.mjs';
import { encodeJpeg } from './jpegenc.mjs';
import { decodeImage } from './image.mjs';

const JPEG_QUALITY = 93;
// 图表里最小的字（刻度、类目）至少这么大，和程序排字的下限一致。
const MIN_SIZE_RATIO = 0.008;
const MIN_SIZE_PX = 14;
export const MAX_CHARTS = 3;
const MAX_CATEGORIES = 24;
const MAX_SERIES = 6;
const DEFAULT_BOX = [0.08, 0.12, 0.92, 0.92];
// 排不下时整体缩字号的几档。
const SIZE_STEPS = [1, 0.88, 0.77, 0.68, 0.6];

export const CHART_TYPES = { bar: '柱状图', hbar: '条形图', line: '折线图', area: '面积图', pie: '饼图', donut: '环形图' };

const TYPE_PATTERNS = [
  ['hbar', /^(hbar|barh|horizontal|条形|横向|横柱)/i],
  ['bar', /^(bar|column|col|柱)/i],
  ['area', /^(area|面积)/i],
  ['line', /^(line|折线|曲线|趋势|走势)/i],
  ['donut', /^(donut|doughnut|ring|环)/i],
  ['pie', /^(pie|饼|扇)/i],
];

export const CHART_REASONS = {
  not_blank: '底图上预留给图表的地方没有留空',
  marks: '底图上预留给图表的地方已经画了东西',
  too_small: '预留的空白太小，图表的字会小到看不清',
  no_font: '找不到可用的字体',
  missing_glyphs: '字体里缺字',
  bad_data: '图表的数据不完整',
  verify: '从最终文件量回来和数据对不上',
  error: '画图表出错',
};

const PALETTE = ['#4E79A7', '#F28E2B', '#59A14F', '#E15759', '#76B7B2', '#EDC948', '#B07AA1', '#FF9DA7', '#9C755F', '#BAB0AC'];

const tick = () => new Promise((resolve) => setImmediate(resolve));

// ---------------------------------------------------------------- 规格

// 规划写的 charts → 规格。写错的图表丢掉，problems 里说明原因（给事件流看）。
export function normalizeCharts(raw) {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
  const charts = [];
  const problems = [];
  list.slice(0, MAX_CHARTS).forEach((item, index) => {
    const { chart, problem } = normalizeChart(item);
    if (chart) charts.push(chart);
    else problems.push('图表 ' + (index + 1) + '：' + problem);
  });
  return { charts, problems };
}

export function chartType(value) {
  const text = String(value || '').trim();
  for (const [type, pattern] of TYPE_PATTERNS) if (pattern.test(text)) return type;
  return '';
}

// 规划写的（下划线字段）和落盘、追问合并后的（驼峰字段）都认。
export function normalizeChart(raw) {
  if (!raw || typeof raw !== 'object') return { chart: null, problem: '没有写图表' };
  const type = chartType(raw.type);
  if (!type) return { chart: null, problem: '图表类型「' + String(raw.type || '') + '」不认识' };
  const circular = type === 'pie' || type === 'donut';
  const categories = (Array.isArray(raw.categories) ? raw.categories : []).slice(0, MAX_CATEGORIES).map((item) => cleanText(item, 24));
  let rawSeries = Array.isArray(raw.series) ? raw.series : Array.isArray(raw.values) ? [{ name: raw.name, values: raw.values, color: raw.color }] : [];
  if (circular) rawSeries = rawSeries.slice(0, 1);
  const series = rawSeries.slice(0, MAX_SERIES).map((item) => {
    const parsed = (Array.isArray(item && item.values) ? item.values : []).slice(0, MAX_CATEGORIES).map(parseValue);
    return {
      name: cleanText(item && item.name, 24),
      values: parsed.map((one) => one.value),
      decimals: parsed.reduce((max, one) => Math.max(max, one.decimals), 0),
      suffix: parsed.map((one) => one.suffix).find(Boolean) || '',
      color: hexColor(item && item.color),
    };
  });
  if (!categories.length) return { chart: null, problem: '没有类目' };
  if (categories.some((item) => !item)) return { chart: null, problem: '有的类目是空的' };
  if (!series.length) return { chart: null, problem: '没有数据' };
  for (const one of series) {
    const name = one.name || '数据';
    if (one.values.length !== categories.length) return { chart: null, problem: '「' + name + '」有 ' + one.values.length + ' 个数，类目有 ' + categories.length + ' 个' };
    if (one.values.some((value) => !Number.isFinite(value))) return { chart: null, problem: '「' + name + '」里有不是数字的值' };
  }
  if (circular) {
    const values = series[0].values;
    if (values.some((value) => value < 0)) return { chart: null, problem: '饼图、环形图的数不能是负的' };
    if (!(values.reduce((sum, value) => sum + value, 0) > 0)) return { chart: null, problem: '饼图、环形图的数加起来是 0' };
  }
  const lineLike = type === 'line' || type === 'area';
  const bound = (value) => (lineLike && value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null);
  const askedDecimals = Number(raw.decimals);
  const decimals = Number.isInteger(askedDecimals) && askedDecimals >= 0 && askedDecimals <= 4 ? askedDecimals : 0;
  return {
    chart: {
      type,
      title: cleanText(raw.title, 40),
      unit: cleanText(raw.unit, 12) || series.map((one) => one.suffix).find(Boolean) || '',
      categories,
      series: series.map((one) => ({ name: one.name, values: one.values, color: one.color })),
      // 只能比数据本身的小数位多（补 0），不能少：少了就是把 12.5 标成 13。
      decimals: Math.max(decimals, Math.min(4, Math.max(...series.map((one) => one.decimals)))),
      stacked: raw.stacked === true && (type === 'bar' || type === 'hbar') && series.length > 1,
      labels: ['value', 'percent', 'both', 'none'].includes(raw.labels) ? raw.labels : circular ? 'percent' : 'value',
      yMin: bound(raw.y_min ?? raw.yMin),
      yMax: bound(raw.y_max ?? raw.yMax),
      box: boxValue(raw.box),
      surface: cleanText(raw.surface, 40),
      font: normalizeFontKind(raw.font || 'hei'),
      colors: (Array.isArray(raw.colors) ? raw.colors : []).map(hexColor).filter(Boolean).slice(0, MAX_CATEGORIES),
    },
    problem: '',
  };
}

function cleanText(value, limit) {
  const chars = Array.from(String(value === undefined || value === null ? '' : value).replace(/\s+/g, ' ').trim());
  return chars.slice(0, limit).join('');
}

function boxValue(raw) {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const box = raw.map(Number);
  return box.every(Number.isFinite) ? box : null;
}

function hexColor(value) {
  const match = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(value || '').trim());
  if (!match) return '';
  const hex = match[1].length === 3 ? match[1].split('').map((ch) => ch + ch).join('') : match[1];
  return '#' + hex.toUpperCase();
}

function halfWidth(text) {
  return text
    .replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/．/g, '.')
    .replace(/％/g, '%')
    .replace(/[－−]/g, '-')
    .replace(/＋/g, '+');
}

function parseValue(raw) {
  if (typeof raw === 'number') return { value: raw, decimals: decimalsOf(raw), suffix: '' };
  const text = halfWidth(String(raw === undefined || raw === null ? '' : raw)).replace(/\s+/g, '');
  const match = /^([-+]?)((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)(.*)$/.exec(text);
  if (!match) return { value: NaN, decimals: 0, suffix: '' };
  const digits = match[2].replace(/,/g, '');
  const rest = match[3];
  return { value: Number(match[1] + digits), decimals: Math.min(4, (digits.split('.')[1] || '').length), suffix: rest && rest.length <= 4 && !/\d/.test(rest) ? rest : '' };
}

function decimalsOf(value) {
  if (!Number.isFinite(value)) return 0;
  const text = String(value);
  if (/e/i.test(text)) return Math.min(4, Math.max(0, 1 - Math.floor(Math.log10(Math.abs(value) || 1))));
  return Math.min(4, (text.split('.')[1] || '').length);
}

// 用户原话里出现过的数。「120,150,180」既可能是千分位也可能是三个数，两种读法都收。
export function numbersIn(text) {
  const out = [];
  for (const match of halfWidth(String(text || '')).matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const whole = Number(match[0].replace(/,/g, ''));
    if (Number.isFinite(whole)) out.push(whole);
    if (match[0].includes(',')) {
      for (const piece of match[0].split(',')) {
        const value = Number(piece);
        if (piece && Number.isFinite(value)) out.push(value);
      }
    }
  }
  return out;
}

// 换算单位（1.2 亿 = 12000 万、25% = 0.25）和正负号（「下降 5%」写成 -5）都算同一个数。
function sameNumber(value, known) {
  const v = Math.abs(value);
  if (v === 0) return known === 0;
  for (let k = -8; k <= 8; k += 1) {
    const scaled = known * 10 ** k;
    if (Math.abs(v - scaled) <= scaled * 1e-9) return true;
  }
  return false;
}

// 规划写进图表的数是不是都能在用户的原话里找到。比例、合计由程序算，不在这里查。
export function chartDataCheck(chart, sourceText) {
  const known = numbersIn(sourceText);
  const missing = [];
  for (const one of chart.series) {
    for (const value of one.values) if (!known.some((n) => sameNumber(value, n)) && !missing.includes(value)) missing.push(value);
  }
  return { ok: missing.length === 0, missing: missing.slice(0, 8) };
}

// 一句话描述一张图表（编辑节点的清单、交付说明里用）。
export function describeChart(chart) {
  const type = CHART_TYPES[chart.type] || chart.type;
  const series = chart.series
    .map((one) => (one.name ? one.name + '：' : '') + one.values.map((v) => formatNumber(v, chart.decimals, chart.unit === '%')).join('、'))
    .join('；');
  return type + (chart.title ? '「' + chart.title + '」' : '') + '，类目 ' + chart.categories.join('、') + '；' + series + (chart.unit && chart.unit !== '%' ? '（单位：' + chart.unit + '）' : '');
}

// ---------------------------------------------------------------- 刻度与数字

// 整齐的刻度：间隔取 1、2、2.5、5 × 10ⁿ，首尾刻度把数据包住。
export function niceScale(lo, hi, target) {
  let min = Math.min(lo, hi);
  let max = Math.max(lo, hi);
  if (max === min) {
    if (min > 0) min = 0;
    else if (max < 0) max = 0;
    else max = 1;
  }
  const rough = (max - min) / Math.max(2, target || 5);
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  const unit = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  const step = unit * mag;
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9) + (unit === 2.5 ? 1 : 0));
  const start = Math.floor(min / step + 1e-9);
  const end = Math.ceil(max / step - 1e-9);
  const ticks = [];
  for (let i = start; i <= end; i += 1) ticks.push(Number((i * step).toFixed(decimals + 2)));
  return { min: ticks[0], max: ticks[ticks.length - 1], step, ticks, decimals };
}

// 数值轴要包住的范围。柱状图、条形图一律包住 0；折线图默认也从 0 起，规划写了 y_min 才从别处起（刻度上照实标出来）。
function valueRange(chart) {
  if (chart.stacked) {
    let lo = 0;
    let hi = 0;
    chart.categories.forEach((_, i) => {
      let pos = 0;
      let neg = 0;
      for (const one of chart.series) {
        if (one.values[i] >= 0) pos += one.values[i];
        else neg += one.values[i];
      }
      hi = Math.max(hi, pos);
      lo = Math.min(lo, neg);
    });
    return [lo, hi];
  }
  const all = chart.series.flatMap((one) => one.values);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  if (chart.type === 'line' || chart.type === 'area') {
    const from = chart.yMin !== null && chart.yMin <= lo ? chart.yMin : Math.min(0, lo);
    const to = chart.yMax !== null && chart.yMax >= hi ? chart.yMax : hi;
    return [from, to];
  }
  return [Math.min(0, lo), Math.max(0, hi)];
}

// 千分位只给五位以上的数加（中文里 2024、1200 不习惯加逗号）。
export function formatNumber(value, decimals, percent) {
  const fixed = Math.abs(value).toFixed(decimals);
  const [int, frac] = fixed.split('.');
  const grouped = int.length > 4 ? int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : int;
  const negative = value < 0 && Number(fixed) !== 0;
  return (negative ? '-' : '') + grouped + (frac ? '.' + frac : '') + (percent ? '%' : '');
}

// 百分比按最大余数法分配：各自四舍五入加起来常常是 99.9% 或 100.1%，读的人会以为算错了。
export function largestRemainder(values, decimals) {
  const total = values.reduce((sum, value) => sum + value, 0);
  const unit = 10 ** decimals;
  const raw = values.map((value) => (value / total) * 100 * unit);
  const floor = raw.map((value) => Math.floor(value + 1e-9));
  let left = Math.round(100 * unit - floor.reduce((sum, value) => sum + value, 0));
  const order = raw.map((value, i) => ({ i, frac: value - floor[i] })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floor[i] += 1;
    left -= 1;
  }
  return floor.map((value) => value / unit);
}

function percentDecimals(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  return values.every((value) => Math.abs(((value / total) * 100) % 1) < 1e-9) ? 0 : 1;
}

// ---------------------------------------------------------------- 对外入口

// 在已解码的图上画图表，返回最终文件的字节。charts：normalizeChart 的结果。
// 返回 { ok, buffer, format, image, results }；有一张没画成或者核对没通过就整体不通过，buffer 为 null。
export async function overlayCharts(image, format, charts, options) {
  const opts = options || {};
  const startedAt = Date.now();
  const list = (Array.isArray(charts) ? charts : []).filter((chart) => chart && chart.type);
  if (!list.length) return { ok: false, buffer: null, format, image, results: [], ms: 0 };
  const out = { ...image, data: Buffer.from(image.data) };
  const work = analysisImage(image);
  const drawn = [];
  for (const chart of list) {
    let item;
    try {
      item = await renderChart(out, work, image, chart, opts);
    } catch (error) {
      item = { result: failure(chart, 'error', String((error && error.message) || error)), geometry: null };
    }
    drawn.push(item);
    await tick();
  }
  const results = drawn.map((item) => item.result);
  if (!results.every((result) => result.ok)) return { ok: false, buffer: null, format, image, results, ms: Date.now() - startedAt };
  const outFormat = format === 'png' ? 'png' : 'jpeg';
  const buffer = outFormat === 'png' ? encodePng(out, { level: 6 }) : encodeJpeg(out, { quality: JPEG_QUALITY });
  const final = decodeImage(buffer);
  for (const item of drawn) {
    const verify = verifyChart(final, item.geometry);
    item.result.verify = verify;
    if (!verify.ok) Object.assign(item.result, { ok: false, reason: 'verify', reasonText: CHART_REASONS.verify, detail: verify.note });
  }
  const ok = results.every((result) => result.ok);
  return { ok, buffer: ok ? buffer : null, format: outFormat, image: out, results, ms: Date.now() - startedAt };
}

function failure(chart, reason, detail) {
  return {
    type: chart.type,
    title: chart.title || '',
    ok: false,
    reason,
    reasonText: CHART_REASONS[reason] || reason,
    detail: detail || '',
  };
}

async function renderChart(out, work, original, chart, opts) {
  const planned = boxToPixels(chart.box || DEFAULT_BOX, original.width, original.height);
  let region = findBlankRegion(work, planned, original);
  // 按排字的规矩，空白要和规划位置重合过半、颜色离样本不远才算。模型画的面板常常对不齐（真机：白板整体偏左上、
  // 或者比规划的窄），窗光照着的白板左右还能差 70 级、一边冷一边暖，这几张都会被打回重画。图表不像文字非得在某个位置，
  // 换一种认法：沿着平缓的渐变找出整块面板，面板的中心落在规划位置里、面积够大，就画在这块面板上。
  let moved = false;
  if (!region.ok && region.reason === 'not_blank') {
    const panel = findSmoothPanel(work, planned, original);
    if (panel.ok) {
      region = panel;
      moved = true;
    }
  }
  const base = {
    type: chart.type,
    title: chart.title || '',
    planned: normalizedBox(planned, original),
    blank: region.blank ? normalizedBox(region.blank, original) : null,
    coverage: round(region.coverage, 3),
    marks: round(region.marks, 4),
    moved,
  };
  if (!region.ok) return { result: { ...failure(chart, region.reason, region.detail), ...base }, geometry: null };
  const fontInfo = await (opts.resolveFonts || resolveFonts)(chart.font || 'hei', chartChars(chart));
  if (!fontInfo.fonts.length) return { result: { ...failure(chart, 'no_font'), ...base }, geometry: null };
  if (fontInfo.missing.length) return { result: { ...failure(chart, 'missing_glyphs', fontInfo.missing.slice(0, 12).join('')), ...base }, geometry: null };
  const box = region.box;
  const minSize = Math.max(MIN_SIZE_PX, Math.min(original.width, original.height) * MIN_SIZE_RATIO);
  const surface = [region.seed.r, region.seed.g, region.seed.b];
  const ctx = makeContext(out, original, fontInfo.fonts, surface, minSize);
  const side = Math.min(box.w, box.h);
  const start = Math.min(Math.max(side * 0.045, minSize), side * 0.08);
  const circular = chart.type === 'pie' || chart.type === 'donut';
  let layout = null;
  let labelsDropped = false;
  // 数值标注放不下时，先整体缩字号；缩到最小还放不下才去掉数值标注（刻度照样标，数还是能从坐标轴读出来）。
  for (const dropLabels of [false, true]) {
    if (dropLabels && (chart.labels === 'none' || circular)) break;
    const spec = dropLabels ? { ...chart, labels: 'none' } : chart;
    for (const k of SIZE_STEPS) {
      const s = start * k;
      if (s < minSize) break;
      layout = circular ? layoutPie(ctx, spec, box, s) : layoutCartesian(ctx, spec, box, s);
      if (layout) break;
    }
    if (layout) {
      labelsDropped = dropLabels;
      break;
    }
  }
  if (!layout) return { result: { ...failure(chart, 'too_small', '预留的区域 ' + Math.round(box.w) + '×' + Math.round(box.h) + ' 像素放不下这张图表'), ...base, box: normalizedBox(box, original) }, geometry: null };
  if (circular) paintPie(ctx, layout);
  else paintCartesian(ctx, layout);
  const geometry = { ...layout, surface, ink: ctx.ink };
  return {
    result: {
      ...base,
      ok: true,
      reason: '',
      reasonText: '',
      detail: '',
      box: normalizedBox(box, original),
      font: fontInfo.label,
      size: Math.round(layout.s),
      labelsDropped,
      scale: layout.scale ? { min: layout.scale.min, max: layout.scale.max, step: layout.scale.step } : null,
      labels: layout.valueTexts || [],
      warning: layout.warning || '',
    },
    geometry,
  };
}

// ---------------------------------------------------------------- 找面板（光照渐变也认）

// 从规划位置里最平的一块出发，沿着「相邻两点颜色差得很少、本身也不是边缘」往外长出整块面板，再在里面找最大的空白矩形。
// 边框、笔画、物体的边缘梯度大，长不过去；光照渐变每一步只差零点几级，挡不住。
// 生长和取矩形都限制在规划位置往外扩 15% 的范围里：面板再大，图表也不会跑到规划给别的东西（标题、主体）的地方去。
// 返回和 findBlankRegion 一样的字段：{ ok, reason, detail, box, blank, seed, coverage, marks }。
export function findSmoothPanel(work, planned, image) {
  const { w: W, h: H, factor: f, r, g, b, grad } = work;
  const fail = (detail) => ({ ok: false, reason: 'not_blank', detail, coverage: 0, marks: 0 });
  const p = {
    x0: clampInt(planned.x / f, 0, W),
    y0: clampInt(planned.y / f, 0, H),
    x1: clampInt((planned.x + planned.w) / f, 0, W),
    y1: clampInt((planned.y + planned.h) / f, 0, H),
  };
  const pw = p.x1 - p.x0;
  const ph = p.y1 - p.y0;
  if (pw < 8 || ph < 8) return fail('规划的位置太小');
  let seed = null;
  for (let gy = 0; gy < 3; gy += 1) {
    for (let gx = 0; gx < 3; gx += 1) {
      const bx0 = Math.floor(p.x0 + pw * (0.12 + (0.76 * gx) / 3));
      const bx1 = Math.floor(p.x0 + pw * (0.12 + (0.76 * (gx + 1)) / 3));
      const by0 = Math.floor(p.y0 + ph * (0.12 + (0.76 * gy) / 3));
      const by1 = Math.floor(p.y0 + ph * (0.12 + (0.76 * (gy + 1)) / 3));
      const grads = [];
      let sr = 0;
      let sg = 0;
      let sb = 0;
      for (let y = by0; y < by1; y += 1) {
        for (let x = bx0; x < bx1; x += 1) {
          const i = y * W + x;
          grads.push(grad[i]);
          sr += r[i];
          sg += g[i];
          sb += b[i];
        }
      }
      if (!grads.length) continue;
      const mean = grads.reduce((sum, v) => sum + v, 0) / grads.length;
      if (!seed || mean < seed.grad) {
        grads.sort((x, y) => x - y);
        seed = { grad: mean, grad90: grads[Math.floor(grads.length * 0.9)], block: [bx0, by0, bx1, by1], r: sr / grads.length, g: sg / grads.length, b: sb / grads.length };
      }
    }
  }
  if (!seed) return fail('规划的位置超出画面');
  // 门槛比排字宽：白板上窗户的镜面反光、屏幕上的微弱倒影是梯度 4–12 的浅线，图表画在上面没关系；
  // 模型偷偷画的线条、伪文字、边框是梯度 20 以上的深线，照样挡得住（真机 A-r1-g0）。
  const tolGrad = clamp(seed.grad90 * 3 + 6, 12, 30);
  const tolStep = clamp(seed.grad * 2 + 5, 7, 14);
  const win = {
    x0: clampInt(p.x0 - pw * 0.15, 0, W),
    y0: clampInt(p.y0 - ph * 0.15, 0, H),
    x1: clampInt(p.x1 + pw * 0.15, 0, W),
    y1: clampInt(p.y1 + ph * 0.15, 0, H),
  };
  const filled = new Uint8Array(W * H);
  const queue = new Int32Array(W * H);
  let head = 0;
  let tail = 0;
  const [sx0, sy0, sx1, sy1] = seed.block;
  for (let y = sy0; y < sy1; y += 1) {
    for (let x = sx0; x < sx1; x += 1) {
      const i = y * W + x;
      if (grad[i] <= tolGrad && !filled[i]) {
        filled[i] = 1;
        queue[tail++] = i;
      }
    }
  }
  const step = (i, j) => Math.max(Math.abs(r[i] - r[j]), Math.abs(g[i] - g[j]), Math.abs(b[i] - b[j]));
  while (head < tail) {
    const i = queue[head++];
    const x = i % W;
    const y = (i / W) | 0;
    const next = [x > win.x0 ? i - 1 : -1, x < win.x1 - 1 ? i + 1 : -1, y > win.y0 ? i - W : -1, y < win.y1 - 1 ? i + W : -1];
    for (const j of next) {
      if (j < 0 || filled[j] || grad[j] > tolGrad || step(i, j) > tolStep) continue;
      filled[j] = 1;
      queue[tail++] = j;
    }
  }
  const side = Math.min(pw, ph);
  const k = Math.max(3, Math.min(Math.round(Math.max(W, H) * 0.012), Math.round(side * 0.2)));
  const rect = maxRectangle(denseMask(filled, W, H, k, 0.92), W, win);
  if (!rect.area) return fail('规划位置附近没有一块平整的面板');
  const blank = { x: rect.x0 * f, y: rect.y0 * f, w: (rect.x1 - rect.x0) * f, h: (rect.y1 - rect.y0) * f };
  const s = Math.min(blank.w, blank.h);
  const pad = Math.round(Math.min(Math.max(Math.min(image.width, image.height) * 0.02, s * 0.035), s * 0.08));
  const box = { x: blank.x + pad, y: blank.y + pad, w: blank.w - 2 * pad, h: blank.h - 2 * pad };
  const coverage = (box.w * box.h) / Math.max(1, planned.w * planned.h);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const inside = cx >= planned.x && cx <= planned.x + planned.w && cy >= planned.y && cy <= planned.y + planned.h;
  // 面板比规划的窄一些也用（真机 A-r1-g1：白板只有规划位置的 41%），中心得在规划位置里，不能是旁边别的平整地方。
  if (!inside || coverage < 0.35 || Math.min(box.w, box.h) < Math.min(planned.w, planned.h) * 0.45) {
    return { ...fail('规划位置附近的平整面板只有规划位置的 ' + Math.round(coverage * 100) + '%'), coverage, blank };
  }
  // 面板上零星的笔迹、伪文字长不进面板，会在矩形里留下洞：图表压在上面会露出来。
  let holes = 0;
  let total = 0;
  for (let y = Math.ceil(box.y / f); y < Math.floor((box.y + box.h) / f); y += 1) {
    for (let x = Math.ceil(box.x / f); x < Math.floor((box.x + box.w) / f); x += 1) {
      total += 1;
      if (!filled[y * W + x]) holes += 1;
    }
  }
  const marks = holes / Math.max(1, total);
  if (marks > 0.01) {
    return { ok: false, reason: 'marks', detail: '面板上有 ' + (marks * 100).toFixed(1) + '% 的地方画了东西', coverage, marks, blank };
  }
  return { ok: true, reason: '', detail: '', box, blank, seed: { r: seed.r, g: seed.g, b: seed.b }, coverage, marks };
}

// 要画的所有字：字体按这些字预先载入字形。数字、标点和「单位：」都带上，刻度怎么定都不会缺字。
function chartChars(chart) {
  const parts = ['0123456789.,-%（）：单位系列', chart.title, chart.unit, ...chart.categories, ...chart.series.map((one) => one.name)];
  return Array.from(new Set(Array.from(parts.join('')))).join('');
}

// ---------------------------------------------------------------- 绘制工具

function makeContext(out, original, fonts, surface, minSize) {
  const ink = lumOf(surface) >= 140 ? [51, 51, 51] : [240, 240, 240];
  return { out, original, surface, minSize, ink, shape: makeShaper(fonts) };
}

// 一行字的字形和尺寸。top/bottom 是字墨相对基线的上下沿（像素，向上为正），用来把字的视觉中心对准刻度。
function makeShaper(fonts) {
  const hit = (ch) => {
    for (const font of fonts) {
      const gid = font.glyphId(ch.codePointAt(0));
      if (gid) return { font, gid };
    }
    return null;
  };
  const cache = new Map();
  return (text, size) => {
    const key = size.toFixed(3) + '|' + text;
    if (cache.has(key)) return cache.get(key);
    const items = [];
    let pen = 0;
    let top = -Infinity;
    let bottom = Infinity;
    for (const ch of Array.from(String(text))) {
      if (/\s/.test(ch)) {
        pen += 0.3 * size;
        continue;
      }
      const found = hit(ch);
      if (!found) continue;
      const s = size / found.font.unitsPerEm;
      const outline = found.font.outline(found.gid);
      if (outline) {
        top = Math.max(top, outline.yMax * s);
        bottom = Math.min(bottom, outline.yMin * s);
      }
      items.push({ font: found.font, gid: found.gid, dx: pen, s });
      pen += found.font.advance(found.gid) * s;
    }
    if (!Number.isFinite(top)) {
      top = size * 0.7;
      bottom = 0;
    }
    const shaped = { width: pen, top, bottom, items };
    cache.set(key, shaped);
    return shaped;
  };
}

// 字的视觉中心线穿过 (ax, ay)。theta 是屏幕上顺时针旋转的弧度。
function placeText(shaped, ax, ay, align, theta) {
  const ox = align === 'center' ? -shaped.width / 2 : align === 'end' ? -shaped.width : 0;
  const c = (shaped.top + shaped.bottom) / 2;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return shaped.items.map((item) => {
    const along = ox + item.dx;
    return { font: item.font, gid: item.gid, m: placeMatrix(item.s, theta, [0, 0], [ax + along * cos - c * sin, ay + along * sin + c * cos]) };
  });
}

function textTile(ctx, text, size, ax, ay, align, theta) {
  const shaped = ctx.shape(text, size);
  if (!shaped.items.length) return null;
  const angle = theta || 0;
  const glyphs = placeText(shaped, ax, ay, align, angle);
  const ox = align === 'center' ? -shaped.width / 2 : align === 'end' ? -shaped.width : 0;
  const c = (shaped.top + shaped.bottom) / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const corners = [];
  for (const along of [ox, ox + shaped.width]) {
    for (const up of [shaped.bottom - c, shaped.top - c]) corners.push([ax + along * cos + up * sin, ay + along * sin - up * cos]);
  }
  const margin = Math.ceil(size * 0.3) + 3;
  const x0 = Math.floor(Math.min(...corners.map((p) => p[0]))) - margin;
  const y0 = Math.floor(Math.min(...corners.map((p) => p[1]))) - margin;
  const x1 = Math.ceil(Math.max(...corners.map((p) => p[0]))) + margin;
  const y1 = Math.ceil(Math.max(...corners.map((p) => p[1]))) + margin;
  const mask = { x: x0, y: y0, w: x1 - x0, h: y1 - y0, data: new Float32Array((x1 - x0) * (y1 - y0)) };
  drawGlyphs(mask, glyphs);
  return mask;
}

// 轴对齐的矩形，边缘按覆盖面积算抗锯齿。
function rectTile(x0, y0, x1, y1) {
  if (!(x1 > x0) || !(y1 > y0)) return null;
  const ix0 = Math.floor(x0);
  const iy0 = Math.floor(y0);
  const w = Math.ceil(x1) - ix0;
  const h = Math.ceil(y1) - iy0;
  const data = new Float32Array(w * h);
  const cover = (a, b, i) => Math.max(0, Math.min(b, i + 1) - Math.max(a, i));
  const cx = new Float32Array(w);
  for (let i = 0; i < w; i += 1) cx[i] = cover(x0, x1, ix0 + i);
  for (let j = 0; j < h; j += 1) {
    const cy = cover(y0, y1, iy0 + j);
    for (let i = 0; i < w; i += 1) data[j * w + i] = cx[i] * cy;
  }
  return { x: ix0, y: iy0, w, h, data };
}

// 任意简单多边形（像素坐标，y 向下），借字形光栅化做精确面积的抗锯齿。
function polygonTile(points) {
  if (!points || points.length < 3) return null;
  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  for (const [x, y] of points) {
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  return rasterizeGlyph({ contours: [points.map(([x, y]) => ({ x, y, on: true }))], xMin, yMin, xMax, yMax }, [1, 0, 0, 1, 0, 0]);
}

function circlePoints(cx, cy, r) {
  const n = Math.max(24, Math.min(720, Math.ceil((2 * Math.PI * r) / 1.5)));
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}

function wedgePoints(cx, cy, r0, r1, a0, a1) {
  const steps = Math.max(2, Math.ceil((a1 - a0) / Math.min(Math.PI / 360, 1.5 / r1)));
  const outer = [];
  for (let i = 0; i <= steps; i += 1) {
    const a = a0 + ((a1 - a0) * i) / steps;
    outer.push([cx + r1 * Math.cos(a), cy + r1 * Math.sin(a)]);
  }
  if (r0 <= 0) return [[cx, cy], ...outer];
  const inner = [];
  for (let i = steps; i >= 0; i -= 1) {
    const a = a0 + ((a1 - a0) * i) / steps;
    inner.push([cx + r0 * Math.cos(a), cy + r0 * Math.sin(a)]);
  }
  return outer.concat(inner);
}

function segmentPoints(x0, y0, x1, y1, width) {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const nx = (-(y1 - y0) / len) * (width / 2);
  const ny = ((x1 - x0) / len) * (width / 2);
  return [[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]];
}

// 几块蒙版取最大值合成一块：折线的每一段、拐点和数据点各画各的再合并，重叠的地方不会叠深。
function unionTiles(tiles) {
  const list = tiles.filter(Boolean);
  if (!list.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const t of list) {
    x0 = Math.min(x0, t.x);
    y0 = Math.min(y0, t.y);
    x1 = Math.max(x1, t.x + t.w);
    y1 = Math.max(y1, t.y + t.h);
  }
  const w = x1 - x0;
  const h = y1 - y0;
  const data = new Float32Array(w * h);
  for (const t of list) {
    for (let ty = 0; ty < t.h; ty += 1) {
      const row = (t.y + ty - y0) * w + (t.x - x0);
      for (let tx = 0; tx < t.w; tx += 1) {
        const v = t.data[ty * t.w + tx];
        if (v > data[row + tx]) data[row + tx] = v;
      }
    }
  }
  return { x: x0, y: y0, w, h, data };
}

function strokeTile(points, width) {
  const pieces = [];
  for (let i = 1; i < points.length; i += 1) pieces.push(polygonTile(segmentPoints(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1], width)));
  for (let i = 1; i < points.length - 1; i += 1) pieces.push(polygonTile(circlePoints(points[i][0], points[i][1], width / 2)));
  return unionTiles(pieces);
}

// 按「印在面板上」的方式叠：颜色乘上这一点面板的明暗（相对面板平均亮度，限制在 ±8%），纸纹和光影还在。
function paint(ctx, tile, rgb, opacity) {
  if (!tile) return;
  const { out, surface } = ctx;
  const { data, channels, width, height } = out;
  const op = opacity === undefined ? 1 : opacity;
  const gray = (rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114);
  const surfGray = lumOf(surface);
  for (let ty = 0; ty < tile.h; ty += 1) {
    const y = tile.y + ty;
    if (y < 0 || y >= height) continue;
    for (let tx = 0; tx < tile.w; tx += 1) {
      const x = tile.x + tx;
      if (x < 0 || x >= width) continue;
      const a = tile.data[ty * tile.w + tx] * op;
      if (a <= 0.002) continue;
      const i = (y * width + x) * channels;
      if (channels < 3) {
        const light = clamp(data[i] / Math.max(1, surfGray), 0.92, 1.08);
        data[i] = Math.round(data[i] * (1 - a) + clamp(gray * light, 0, 255) * a);
        continue;
      }
      for (let c = 0; c < 3; c += 1) {
        const base = data[i + c];
        const light = clamp(base / Math.max(1, surface[c]), 0.92, 1.08);
        data[i + c] = Math.round(base * (1 - a) + clamp(rgb[c] * light, 0, 255) * a);
      }
    }
  }
}

// 把蒙版盖住的地方恢复成底图原样（饼图扇形之间的分隔线：露出面板本身）。
function restore(ctx, tile) {
  if (!tile) return;
  const { out, original } = ctx;
  const { data, channels, width, height } = out;
  for (let ty = 0; ty < tile.h; ty += 1) {
    const y = tile.y + ty;
    if (y < 0 || y >= height) continue;
    for (let tx = 0; tx < tile.w; tx += 1) {
      const x = tile.x + tx;
      if (x < 0 || x >= width) continue;
      const a = tile.data[ty * tile.w + tx];
      if (a <= 0.002) continue;
      const i = (y * width + x) * channels;
      for (let c = 0; c < Math.min(3, channels); c += 1) data[i + c] = Math.round(data[i + c] * (1 - a) + original.data[i + c] * a);
    }
  }
}

function fitSize(ctx, texts, size, maxWidth) {
  const widest = Math.max(...texts.map((text) => ctx.shape(text, size).width));
  return widest > maxWidth ? (size * maxWidth) / widest : size;
}

function contrastInk(rgb) {
  return lumOf(rgb) >= 150 ? [40, 40, 40] : [255, 255, 255];
}

// 系列颜色：规划给的颜色和面板太接近（看不清、也量不出来）就换成调色板里的颜色。
function pickColors(wanted, count, surface) {
  const used = [];
  const result = [];
  for (let i = 0; i < count; i += 1) {
    let rgb = parseHex(wanted[i]);
    if (!rgb || colorDistance(rgb, surface) < 90 || used.some((other) => colorDistance(other, rgb) < 40)) {
      rgb = PALETTE.map(parseHex).find((candidate) => colorDistance(candidate, surface) >= 90 && !used.some((other) => colorDistance(other, candidate) < 40)) || parseHex(PALETTE[i % PALETTE.length]);
    }
    used.push(rgb);
    result.push(rgb);
  }
  return result;
}

// 图例：色块 + 名字，排不下就换行，每行居中。
function legendRows(ctx, items, left, right, top, size) {
  const q = size * 0.8;
  const gap = size * 1.2;
  const widths = items.map((item) => q + size * 0.4 + ctx.shape(item.text, size).width);
  if (Math.max(...widths) > right - left) return null;
  const rows = [];
  let row = [];
  let used = 0;
  items.forEach((item, i) => {
    const need = (row.length ? gap : 0) + widths[i];
    if (row.length && used + need > right - left) {
      rows.push({ row, used });
      row = [];
      used = 0;
    }
    used += row.length ? gap + widths[i] : widths[i];
    row.push({ item, width: widths[i] });
  });
  if (row.length) rows.push({ row, used });
  const rowH = size * 1.6;
  const placed = [];
  rows.forEach(({ row: entries, used: width }, r) => {
    let x = (left + right) / 2 - width / 2;
    const cy = top + rowH * (r + 0.5);
    for (const { item, width: w } of entries) {
      placed.push({ swatch: [x, cy - q / 2, x + q, cy + q / 2], rgb: item.rgb, text: item.text, size, x: x + q + size * 0.4, y: cy, align: 'start' });
      x += w + gap;
    }
  });
  return { items: placed, height: rows.length * rowH };
}

// ---------------------------------------------------------------- 直角坐标（柱状、条形、折线、面积）

function layoutCartesian(ctx, chart, box, s) {
  const { minSize, ink } = ctx;
  const horizontal = chart.type === 'hbar';
  const lineLike = chart.type === 'line' || chart.type === 'area';
  const n = chart.categories.length;
  const m = chart.series.length;
  const percent = chart.unit === '%';
  const showValues = chart.labels !== 'none';
  const colors = pickColors(chart.series.map((one, j) => one.color || chart.colors[j] || ''), m, ctx.surface);
  const perCategory = !lineLike && m === 1 && chart.colors.length >= n;
  const barColors = perCategory ? pickColors(chart.colors, n, ctx.surface) : null;
  const pad = s * 0.5;
  const area = { left: box.x + pad, right: box.x + box.w - pad, top: box.y + pad, bottom: box.y + box.h - pad };
  const L = { kind: lineLike ? 'lines' : 'bars', horizontal, s, texts: [], legend: [], grid: [], axes: [], tickMarks: [], ticks: [], bars: [], lines: [], points: [], valueTexts: [] };
  if (chart.title) {
    const size = fitSize(ctx, [chart.title], s * 1.3, area.right - area.left);
    if (size < minSize) return null;
    L.texts.push({ text: chart.title, size, x: (area.left + area.right) / 2, y: area.top + size * 0.55, align: 'center', rgb: ink });
    area.top += size * 1.5;
  }
  if (m > 1) {
    const legend = legendRows(ctx, chart.series.map((one, j) => ({ text: one.name || '系列 ' + (j + 1), rgb: barColors ? barColors[j] : colors[j] })), area.left, area.right, area.top, s * 0.9);
    if (!legend) return null;
    L.legend = legend.items;
    area.top += legend.height + s * 0.2;
  }
  if (chart.unit && !percent) {
    const size = s * 0.85;
    L.texts.push({ text: '单位：' + chart.unit, size, x: horizontal ? area.right : area.left, y: area.top + size * 0.55, align: horizontal ? 'end' : 'start', rgb: ink });
    area.top += size * 1.4;
  }
  const tickSize = s * 0.9;
  const valueSize = s * 0.85;
  const axisW = Math.max(2, s * 0.06);
  const gridW = Math.max(1.5, s * 0.04);
  const tickW = Math.max(1.8, gridW * 1.2);
  const tickLen = Math.max(axisW + 4, s * 0.35);
  const gapV = Math.max(4, valueSize * 0.3);
  const range = valueRange(chart);
  const negatives = range[0] < 0;
  const fmt = (v) => formatNumber(v, chart.decimals, percent);
  Object.assign(L, { axisW, gridW, tickW, tickLen });

  if (!horizontal) {
    const catSize0 = s * 0.9;
    const roughH = area.bottom - area.top - catSize0 * 2 - (showValues ? valueSize * 1.6 : s * 0.5);
    const scale = niceScale(range[0], range[1], clampInt(Math.round(roughH / (s * 2.4)), 3, 8));
    const tickTexts = scale.ticks.map((t) => formatNumber(t, scale.decimals, percent));
    const labelW = Math.max(...tickTexts.map((t) => ctx.shape(t, tickSize).width));
    const x0 = area.left + labelW + s * 0.25 + tickLen;
    const x1 = area.right - (lineLike ? s * 0.4 : 0);
    if (x1 - x0 < s * 4) return null;
    const slot = (x1 - x0) / n;
    let catSize = catSize0;
    let rotate = false;
    const widest = (size) => Math.max(...chart.categories.map((c) => ctx.shape(c, size).width));
    let catW = widest(catSize);
    if (catW > slot * 0.92) {
      const fit = (catSize * slot * 0.92) / catW;
      if (fit >= Math.max(minSize, catSize * 0.7)) catSize = fit;
      else {
        rotate = true;
        catSize = Math.max(minSize, catSize * 0.85);
        // 斜放的类目文字之间的垂直距离是 slot × sin45°，比字高还小就会叠在一起。
        if (slot * Math.SQRT1_2 < catSize * 1.05) return null;
      }
      catW = widest(catSize);
      // 第一个类目斜着往左下伸，伸出预留的区域就会画到底图别的东西上。
      if (rotate && x0 + slot * 0.5 + catSize * 0.3 - catW * Math.SQRT1_2 < box.x) return null;
    }
    const negRoom = negatives && showValues && !lineLike ? valueSize * 1.3 : 0;
    const catH = rotate ? catW * Math.SQRT1_2 + catSize * 1.1 : catSize * 1.7;
    const y1 = area.bottom - catH - negRoom;
    const y0 = area.top + (showValues ? valueSize * 1.6 : s * 0.5);
    if (y1 - y0 < s * 4) return null;
    const Y = (v) => y1 - ((v - scale.min) / (scale.max - scale.min)) * (y1 - y0);
    const zero = scale.min <= 0 && scale.max >= 0 ? 0 : scale.min;
    Object.assign(L, { plot: { x0, y0, x1, y1 }, scale, extent: y1 - y0, zeroPos: Y(zero) });
    scale.ticks.forEach((t, i) => {
      const pos = Y(t);
      L.ticks.push({ value: t, pos, text: tickTexts[i] });
      if (Math.abs(t - zero) > scale.step * 1e-6) L.grid.push([x0 + axisW / 2, pos - gridW / 2, x1, pos + gridW / 2]);
      L.tickMarks.push([x0 - tickLen, pos - tickW / 2, x0 - axisW / 2, pos + tickW / 2]);
      L.texts.push({ text: tickTexts[i], size: tickSize, x: x0 - tickLen - s * 0.25, y: pos, align: 'end', rgb: ink });
    });
    L.axes.push([x0 - axisW / 2, y0, x0 + axisW / 2, y1 + axisW / 2]);
    L.axes.push([x0, Y(zero) - axisW / 2, x1, Y(zero) + axisW / 2]);
    chart.categories.forEach((text, i) => {
      const cx = x0 + slot * (i + 0.5);
      const top = y1 + negRoom;
      if (rotate) L.texts.push({ text, size: catSize, x: cx + catSize * 0.3, y: top + catSize * 0.55, align: 'end', theta: -Math.PI / 4, rgb: ink });
      else L.texts.push({ text, size: catSize, x: cx, y: top + catSize * 0.85, align: 'center', rgb: ink });
    });
    if (lineLike) {
      const lw = Math.max(2.5, s * 0.1);
      const r = Math.max(lw * 1.25, s * 0.17);
      const baseValue = zero;
      chart.series.forEach((one, j) => {
        const pts = one.values.map((v, i) => [x0 + slot * (i + 0.5), Y(v)]);
        L.lines.push({ rgb: colors[j], points: pts, width: lw, r, area: chart.type === 'area' ? [[pts[0][0], Y(baseValue)], ...pts, [pts[pts.length - 1][0], Y(baseValue)]] : null });
        pts.forEach(([x, y], i) => L.points.push({ x, y, r, width: lw, rgb: colors[j], series: j, value: one.values[i], label: fmt(one.values[i]) }));
      });
      if (showValues && !placePointLabels(ctx, L, chart, slot, valueSize, y0, y1)) return null;
    } else {
      const placed = placeVerticalBars(ctx, L, chart, { x0, slot, Y, colors, barColors, valueSize, gapV, fmt, showValues });
      if (!placed) return null;
    }
    L.valueTexts = chart.series.map((one) => one.values.map(fmt));
    return L;
  }

  // 条形图：类目在左边从上往下排，数值轴在下面。
  const catSize0 = s * 0.9;
  const scale = niceScale(range[0], range[1], clampInt(Math.round(((area.right - area.left) * 0.6) / (s * 3.4)), 3, 7));
  const tickTexts = scale.ticks.map((t) => formatNumber(t, scale.decimals, percent));
  const y1 = area.bottom - tickLen - tickSize * 1.7;
  const y0 = area.top + s * 0.2;
  if (y1 - y0 < s * 3) return null;
  const slot = (y1 - y0) / n;
  let catSize = Math.min(catSize0, slot / 1.15);
  if (catSize < minSize) return null;
  let catW = Math.max(...chart.categories.map((c) => ctx.shape(c, catSize).width));
  const maxCatW = (area.right - area.left) * 0.36;
  if (catW > maxCatW) {
    catSize = (catSize * maxCatW) / catW;
    if (catSize < minSize) return null;
    catW = maxCatW;
  }
  const valueTexts = chart.series.flatMap((one) => one.values.map(fmt));
  const totalTexts = chart.stacked ? chart.categories.map((_, i) => formatNumber(chart.series.reduce((sum, one) => sum + Math.max(0, one.values[i]), 0), chart.decimals, percent)) : [];
  const endTexts = chart.stacked ? totalTexts : valueTexts;
  const valW = showValues ? Math.max(...endTexts.map((t) => ctx.shape(t, valueSize).width)) + s * 0.35 : 0;
  const lastTickW = ctx.shape(tickTexts[tickTexts.length - 1], tickSize).width;
  const firstTickW = ctx.shape(tickTexts[0], tickSize).width;
  const x0 = area.left + catW + s * 0.45 + Math.max(negatives && showValues ? valW : 0, firstTickW / 2 - catW - s * 0.45, 0);
  const x1 = area.right - Math.max(valW, lastTickW / 2);
  if (x1 - x0 < s * 4) return null;
  const X = (v) => x0 + ((v - scale.min) / (scale.max - scale.min)) * (x1 - x0);
  const zero = scale.min <= 0 && scale.max >= 0 ? 0 : scale.min;
  Object.assign(L, { plot: { x0, y0, x1, y1 }, scale, extent: x1 - x0, zeroPos: X(zero) });
  scale.ticks.forEach((t, i) => {
    const pos = X(t);
    L.ticks.push({ value: t, pos, text: tickTexts[i] });
    if (Math.abs(t - zero) > scale.step * 1e-6) L.grid.push([pos - gridW / 2, y0, pos + gridW / 2, y1 - axisW / 2]);
    L.tickMarks.push([pos - tickW / 2, y1 + axisW / 2, pos + tickW / 2, y1 + tickLen]);
    L.texts.push({ text: tickTexts[i], size: tickSize, x: pos, y: y1 + tickLen + tickSize * 0.85, align: 'center', rgb: ink });
  });
  L.axes.push([x0 - axisW / 2, y1 - axisW / 2, x1, y1 + axisW / 2]);
  L.axes.push([X(zero) - axisW / 2, y0, X(zero) + axisW / 2, y1]);
  chart.categories.forEach((text, i) => {
    L.texts.push({ text, size: catSize, x: area.left + catW, y: y0 + slot * (i + 0.5), align: 'end', rgb: ink });
  });
  const band = m === 1 || chart.stacked ? slot * 0.6 : slot * 0.78;
  const bh = chart.stacked ? band : band / m;
  const gap = m > 1 && !chart.stacked ? bh * 0.1 : 0;
  if (showValues && !chart.stacked && valueSize * 1.05 > bh + gap) return null;
  chart.categories.forEach((_, i) => {
    const cy = y0 + slot * (i + 0.5);
    let pos = 0;
    let neg = 0;
    chart.series.forEach((one, j) => {
      const v = one.values[i];
      let from = 0;
      let to = v;
      if (chart.stacked) {
        if (v >= 0) {
          from = pos;
          pos += v;
          to = pos;
        } else {
          from = neg;
          neg += v;
          to = neg;
        }
      }
      const top = chart.stacked ? cy - band / 2 : cy - band / 2 + j * bh + gap / 2;
      const bottom = chart.stacked ? cy + band / 2 : top + bh - gap;
      const a = X(from);
      const b = X(to);
      const rgb = barColors ? barColors[i] : colors[j];
      const bar = { x0: Math.min(a, b), x1: Math.max(a, b), y0: top, y1: bottom, start: a, end: b, from, to, rgb, cross: [top, bottom], label: fmt(v) };
      L.bars.push(bar);
      if (!showValues) return;
      if (chart.stacked) {
        const w = ctx.shape(bar.label, valueSize).width;
        if (Math.abs(b - a) >= w + s * 0.4 && bottom - top >= valueSize * 1.15) L.texts.push({ text: bar.label, size: valueSize, x: (a + b) / 2, y: cy, align: 'center', rgb: contrastInk(rgb) });
      } else {
        L.texts.push({ text: bar.label, size: valueSize, x: v >= 0 ? b + gapV : b - gapV, y: (top + bottom) / 2, align: v >= 0 ? 'start' : 'end', rgb: ink });
      }
    });
    if (chart.stacked && showValues && pos > 0) {
      const total = formatNumber(pos, chart.decimals, percent);
      L.texts.push({ text: total, size: valueSize, x: X(pos) + gapV, y: cy, align: 'start', rgb: ink });
    }
  });
  L.valueTexts = chart.series.map((one) => one.values.map(fmt));
  return L;
}

function placeVerticalBars(ctx, L, chart, o) {
  const { x0, slot, Y, colors, barColors, valueSize, gapV, fmt, showValues } = o;
  const m = chart.series.length;
  const group = m === 1 || chart.stacked ? slot * 0.56 : slot * 0.76;
  const bw = chart.stacked ? group : group / m;
  const gap = m > 1 && !chart.stacked ? bw * 0.1 : 0;
  for (let i = 0; i < chart.categories.length; i += 1) {
    const cx = x0 + slot * (i + 0.5);
    let pos = 0;
    let neg = 0;
    for (let j = 0; j < m; j += 1) {
      const v = chart.series[j].values[i];
      let from = 0;
      let to = v;
      if (chart.stacked) {
        if (v >= 0) {
          from = pos;
          pos += v;
          to = pos;
        } else {
          from = neg;
          neg += v;
          to = neg;
        }
      }
      const left = chart.stacked ? cx - group / 2 : cx - group / 2 + j * bw + gap / 2;
      const right = chart.stacked ? cx + group / 2 : left + bw - gap;
      const a = Y(from);
      const b = Y(to);
      const rgb = barColors ? barColors[i] : colors[j];
      const bar = { x0: left, x1: right, y0: Math.min(a, b), y1: Math.max(a, b), start: a, end: b, from, to, rgb, cross: [left, right], label: fmt(v) };
      L.bars.push(bar);
      if (!showValues) continue;
      const width = ctx.shape(bar.label, valueSize).width;
      if (chart.stacked) {
        if (Math.abs(b - a) >= valueSize * 1.25 && width <= (right - left) * 0.94) L.texts.push({ text: bar.label, size: valueSize, x: cx, y: (a + b) / 2, align: 'center', rgb: contrastInk(rgb) });
        continue;
      }
      // 数值标注不能比柱子所在的那一格宽，否则会和旁边的标注叠在一起。
      if (width > (m === 1 ? slot * 0.98 : bw * 1.02)) return false;
      const up = v >= 0;
      L.texts.push({ text: bar.label, size: valueSize, x: (left + right) / 2, y: up ? b - gapV - valueSize * 0.38 : b + gapV + valueSize * 0.38, align: 'center', rgb: ctx.ink });
    }
    if (chart.stacked && showValues && pos > 0) {
      const total = formatNumber(pos, chart.decimals, chart.unit === '%');
      if (ctx.shape(total, valueSize).width > slot * 0.98) return false;
      L.texts.push({ text: total, size: valueSize, x: cx, y: Y(pos) - gapV - valueSize * 0.38, align: 'center', rgb: ctx.ink });
    }
  }
  return true;
}

// 折线的数值标注：每个类目里位置最高的点标在上方，其余的往下找不和别人重叠的位置。
function placePointLabels(ctx, L, chart, slot, valueSize, y0, y1) {
  const h = valueSize * 1.05;
  const byCategory = new Map();
  for (const point of L.points) {
    const list = byCategory.get(point.x) || [];
    list.push(point);
    byCategory.set(point.x, list);
  }
  for (const [x, points] of byCategory) {
    const taken = [];
    points.sort((a, b) => a.y - b.y);
    for (const p of points) {
      const width = ctx.shape(p.label, valueSize).width;
      if (width > slot * 0.98) return false;
      const options = [p.y - p.r - valueSize * 0.62, p.y + p.r + valueSize * 0.62];
      for (let k = 1; k <= 3; k += 1) options.push(p.y + p.r + valueSize * 0.62 + k * h);
      const y = options.find((cy) => cy - h / 2 >= y0 - valueSize * 1.5 && cy + h / 2 <= y1 + valueSize * 0.2 && !taken.some((other) => Math.abs(other - cy) < h));
      if (y === undefined) return false;
      taken.push(y);
      L.texts.push({ text: p.label, size: valueSize, x, y, align: 'center', rgb: ctx.ink });
    }
  }
  return true;
}

function paintCartesian(ctx, L) {
  for (const rect of L.grid) paint(ctx, rectTile(...rect), ctx.ink, 0.16);
  for (const line of L.lines) if (line.area) paint(ctx, polygonTile(line.area), line.rgb, 0.18);
  for (const bar of L.bars) paint(ctx, rectTile(bar.x0, bar.y0, bar.x1, bar.y1), bar.rgb, 1);
  for (const rect of L.axes) paint(ctx, rectTile(...rect), ctx.ink, 0.85);
  for (const rect of L.tickMarks) paint(ctx, rectTile(...rect), ctx.ink, 0.85);
  for (const line of L.lines) {
    const marks = line.points.map(([x, y]) => polygonTile(circlePoints(x, y, line.r)));
    line.tile = unionTiles([strokeTile(line.points, line.width), ...marks]);
    paint(ctx, line.tile, line.rgb, 1);
  }
  for (const item of L.legend) paint(ctx, rectTile(...item.swatch), item.rgb, 1);
  for (const item of L.legend) paint(ctx, textTile(ctx, item.text, item.size, item.x, item.y, item.align, 0), ctx.ink, 1);
  for (const t of L.texts) paint(ctx, textTile(ctx, t.text, t.size, t.x, t.y, t.align, t.theta || 0), t.rgb, 1);
}

// ---------------------------------------------------------------- 饼图、环形图

function layoutPie(ctx, chart, box, s) {
  const { minSize, ink } = ctx;
  const donut = chart.type === 'donut';
  const values = chart.series[0].values;
  const total = values.reduce((sum, value) => sum + value, 0);
  const pd = percentDecimals(values);
  const percents = largestRemainder(values, pd);
  const percentUnit = chart.unit === '%';
  const colors = pickColors(chart.categories.map((_, i) => chart.colors[i] || ''), values.length, ctx.surface);
  const pad = s * 0.5;
  const area = { left: box.x + pad, right: box.x + box.w - pad, top: box.y + pad, bottom: box.y + box.h - pad };
  const P = { kind: 'pie', donut, s, texts: [], legend: [], wedges: [], values, total, valueTexts: [] };
  if (chart.title) {
    const size = fitSize(ctx, [chart.title], s * 1.3, area.right - area.left);
    if (size < minSize) return null;
    P.texts.push({ text: chart.title, size, x: (area.left + area.right) / 2, y: area.top + size * 0.55, align: 'center', rgb: ink });
    area.top += size * 1.5;
  }
  const valueText = (i) => formatNumber(values[i], chart.decimals, percentUnit) + (chart.unit && !percentUnit ? chart.unit : '');
  const pctText = (i) => formatNumber(percents[i], pd, true);
  const entries = chart.categories.map((name, i) => {
    if (chart.labels === 'none') return name;
    if (percentUnit || chart.labels === 'value') return name + '  ' + valueText(i);
    if (chart.labels === 'percent') return name + '  ' + pctText(i);
    return name + '  ' + valueText(i) + '（' + pctText(i) + '）';
  });
  P.valueTexts = chart.categories.map((_, i) => (percentUnit ? valueText(i) : valueText(i) + ' / ' + pctText(i)));
  if (percentUnit && Math.abs(total - 100) > 0.5) P.warning = '各项加起来是 ' + formatNumber(total, chart.decimals, true) + '，不是 100%，扇形按各项的相对大小画';
  let legendSize = s * 0.85;
  const q = () => legendSize * 0.8;
  const rowH = () => legendSize * 1.65;
  const widest = () => Math.max(...entries.map((text) => ctx.shape(text, legendSize).width)) + q() + legendSize * 0.4;
  let pieArea;
  const side = box.w >= box.h * 1.15;
  if (side) {
    const maxW = (area.right - area.left) * 0.48;
    if (widest() > maxW) legendSize = (legendSize * maxW) / widest();
    if (rowH() * entries.length > area.bottom - area.top) legendSize = (area.bottom - area.top) / entries.length / 1.65;
    if (legendSize < minSize) return null;
    const lw = widest();
    const lx = area.right - lw;
    const ly = (area.top + area.bottom) / 2 - (rowH() * entries.length) / 2;
    entries.forEach((text, i) => {
      const cy = ly + rowH() * (i + 0.5);
      P.legend.push({ swatch: [lx, cy - q() / 2, lx + q(), cy + q() / 2], rgb: colors[i], text, size: legendSize, x: lx + q() + legendSize * 0.4, y: cy, align: 'start' });
    });
    pieArea = { left: area.left, right: lx - s * 0.8, top: area.top, bottom: area.bottom };
  } else {
    const legend = legendRows(ctx, entries.map((text, i) => ({ text, rgb: colors[i] })), area.left, area.right, area.top, legendSize);
    if (!legend) return null;
    const shift = area.bottom - legend.height;
    for (const item of legend.items) {
      item.swatch = [item.swatch[0], item.swatch[1] - area.top + shift, item.swatch[2], item.swatch[3] - area.top + shift];
      item.y += shift - area.top;
    }
    P.legend = legend.items;
    pieArea = { left: area.left, right: area.right, top: area.top, bottom: shift - s * 0.4 };
  }
  const R = (Math.min(pieArea.right - pieArea.left, pieArea.bottom - pieArea.top) / 2) * 0.96;
  if (R < s * 2.5) return null;
  const cx = (pieArea.left + pieArea.right) / 2;
  const cy = (pieArea.top + pieArea.bottom) / 2;
  const r0 = donut ? R * 0.56 : 0;
  const sepW = Math.max(2, s * 0.06);
  Object.assign(P, { center: [cx, cy], r0, r1: R, sepW, extent: R });
  let acc = 0;
  const labelSize = s * 0.85;
  values.forEach((value, i) => {
    const a0 = -Math.PI / 2 + (2 * Math.PI * acc) / total;
    acc += value;
    const a1 = -Math.PI / 2 + (2 * Math.PI * acc) / total;
    const wedge = { a0, a1, rgb: colors[i], value, label: null };
    P.wedges.push(wedge);
    if (chart.labels === 'none' || value <= 0) return;
    const text = percentUnit || chart.labels === 'value' ? valueText(i) : pctText(i);
    const shaped = ctx.shape(text, labelSize);
    const rho = donut ? (r0 + R) / 2 : R * 0.64;
    const half = Math.asin(Math.min(1, Math.hypot(shaped.width, labelSize) / 2 / rho));
    const margin = (sepW + 4) / rho + Math.PI / 60;
    // 扇形太窄放不下就不写在扇形里（图例里照样有），也给边界留出量回来核对的余地。
    if ((a1 - a0) / 2 < half + margin) return;
    if (donut && R - r0 < labelSize * 1.4) return;
    const mid = (a0 + a1) / 2;
    wedge.label = { half: half + margin };
    P.texts.push({ text, size: labelSize, x: cx + rho * Math.cos(mid), y: cy + rho * Math.sin(mid), align: 'center', rgb: contrastInk(colors[i]) });
  });
  return P;
}

function paintPie(ctx, P) {
  const [cx, cy] = P.center;
  for (const w of P.wedges) if (w.a1 - w.a0 > 1e-6) paint(ctx, polygonTile(wedgePoints(cx, cy, P.r0, P.r1, w.a0, w.a1)), w.rgb, 1);
  if (P.wedges.filter((w) => w.value > 0).length > 1) {
    for (const w of P.wedges) {
      const inner = Math.max(0, P.r0 - 1);
      const outer = P.r1 + 1.5;
      restore(ctx, polygonTile(segmentPoints(cx + inner * Math.cos(w.a0), cy + inner * Math.sin(w.a0), cx + outer * Math.cos(w.a0), cy + outer * Math.sin(w.a0), P.sepW)));
    }
  }
  for (const item of P.legend) paint(ctx, rectTile(...item.swatch), item.rgb, 1);
  for (const item of P.legend) paint(ctx, textTile(ctx, item.text, item.size, item.x, item.y, item.align, 0), ctx.ink, 1);
  for (const t of P.texts) paint(ctx, textTile(ctx, t.text, t.size, t.x, t.y, t.align, 0), t.rgb, 1);
}

// ---------------------------------------------------------------- 读回核对

function verifyChart(final, geometry) {
  if (!geometry) return { ok: false, note: '没有可核对的图形', checked: 0, maxErrorPx: null, tolerancePx: null, items: [] };
  const read = sampler(final);
  return geometry.kind === 'pie' ? verifyPie(read, geometry) : verifyCartesian(read, geometry);
}

function sampler(image) {
  const { width, height, channels, data } = image;
  const px = (x, y) => {
    const i = (clampInt(y, 0, height - 1) * width + clampInt(x, 0, width - 1)) * channels;
    return channels >= 3 ? [data[i], data[i + 1], data[i + 2]] : [data[i], data[i], data[i]];
  };
  // 连续坐标：像素 i 占 [i, i+1)，中心在 i + 0.5。
  const at = (x, y) => {
    const fx = x - 0.5;
    const fy = y - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const a = px(x0, y0);
    const b = px(x0 + 1, y0);
    const c = px(x0, y0 + 1);
    const d = px(x0 + 1, y0 + 1);
    return [0, 1, 2].map((k) => (a[k] * (1 - tx) + b[k] * tx) * (1 - ty) + (c[k] * (1 - tx) + d[k] * tx) * ty);
  };
  return { at, width, height };
}

// c 在「参照色 → 目标色」这条线上走到了几成（0 是参照色，1 是目标色）。
function membership(c, ref, target) {
  const d = [target[0] - ref[0], target[1] - ref[1], target[2] - ref[2]];
  const denom = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  if (denom < 1) return 0;
  return clamp(((c[0] - ref[0]) * d[0] + (c[1] - ref[1]) * d[1] + (c[2] - ref[2]) * d[2]) / denom, 0, 1);
}

function mean(colors) {
  const sum = [0, 0, 0];
  for (const c of colors) for (let k = 0; k < 3; k += 1) sum[k] += c[k];
  return sum.map((v) => v / Math.max(1, colors.length));
}

function verifyCartesian(read, G) {
  const tol = Math.max(1.5, G.extent * 0.002);
  const items = [];
  const horizontal = G.horizontal;
  // 1. 刻度：沿着刻度短线的中线取样，量出每根刻度线的中心，拟合「数值 → 像素」。
  const fixed = horizontal ? G.plot.y1 + (G.axisW / 2 + G.tickLen) / 2 : G.plot.x0 - (G.axisW / 2 + G.tickLen) / 2;
  const sample = (t) => (horizontal ? read.at(t, fixed) : read.at(fixed, t));
  const spacing = G.ticks.length > 1 ? Math.abs(G.ticks[1].pos - G.ticks[0].pos) : G.extent;
  const win = Math.max(3, Math.min(spacing * 0.4, G.s * 0.6));
  const measured = [];
  for (const tk of G.ticks) {
    const ref = mean([sample(tk.pos - win), sample(tk.pos + win)]);
    let sw = 0;
    let sp = 0;
    for (let t = Math.floor(tk.pos - win + 1); t <= Math.ceil(tk.pos + win - 1); t += 1) {
      const w = Math.max(0, (membership(sample(t + 0.5), ref, G.ink) - 0.15) / 0.85);
      sw += w;
      sp += w * (t + 0.5);
    }
    if (sw < 0.5) {
      items.push({ kind: 'tick', label: tk.text, ok: false, errorPx: null, note: '刻度线没量到' });
      continue;
    }
    measured.push({ value: tk.value, pos: sp / sw, text: tk.text });
  }
  if (measured.length < 2) return summarize(items, tol, '刻度线量到的不到 2 根');
  const fit = linearFit(measured.map((one) => one.value), measured.map((one) => one.pos));
  let axisResidual = 0;
  for (const one of measured) {
    const err = Math.abs(fit.a * one.value + fit.b - one.pos);
    axisResidual = Math.max(axisResidual, err);
    items.push({ kind: 'tick', label: one.text, ok: err <= tol, errorPx: round(err, 2) });
  }
  const predict = (value) => fit.a * value + fit.b;
  // 2. 柱子：从柱子里面往外走，颜色从柱色变到外面的颜色走到一半的位置就是柱端（亚像素）。
  for (const bar of G.bars) {
    const len = Math.abs(bar.end - bar.start);
    if (len < 6) continue;
    const dir = Math.sign(bar.end - bar.start);
    const [c0, c1] = bar.cross;
    const span = c1 - c0;
    const lanes = [0.3, 0.4, 0.5, 0.6, 0.7].map((k) => c0 + span * k);
    const colorAt = (t) => mean(lanes.map((c) => (horizontal ? read.at(t, c) : read.at(c, t))));
    const inside = mean([3, 4, 5].map((d) => colorAt(bar.end - dir * Math.min(d, len / 2))));
    const outside = mean([2.5, 3].map((d) => colorAt(bar.end + dir * d)));
    let edge = null;
    let prev = null;
    const startT = bar.end - dir * Math.min(6, len / 2);
    for (let k = 0; k <= 24; k += 0.5) {
      const t = startT + dir * k;
      const b = membership(colorAt(t), outside, inside);
      if (prev && prev.b >= 0.5 && b < 0.5) {
        edge = prev.t + (t - prev.t) * ((prev.b - 0.5) / (prev.b - b));
        break;
      }
      prev = { t, b };
    }
    if (edge === null) {
      items.push({ kind: 'bar', label: bar.label, ok: false, errorPx: null, note: '柱端没量到' });
      continue;
    }
    const err = Math.abs(edge - predict(bar.to));
    items.push({ kind: 'bar', label: bar.label, ok: err <= tol, errorPx: round(err, 2) });
  }
  // 3. 数据点：数据点附近颜色的重心和程序画的形状的重心比，差多少就是画歪了多少，再和刻度换算的位置比。
  for (const point of G.points) {
    const line = G.lines[point.series];
    if (!line || !line.tile) continue;
    const r = Math.ceil(point.r + 1);
    const target = mean(circlePoints(point.x, point.y, point.r * 0.35).map(([x, y]) => read.at(x, y)).concat([read.at(point.x, point.y)]));
    const ring = circlePoints(point.x, point.y, point.r + point.width * 2 + 4).filter((_, i) => i % 3 === 0).map(([x, y]) => read.at(x, y));
    const ref = medianColor(ring);
    let mw = 0;
    let my = 0;
    let ew = 0;
    let ey = 0;
    for (let y = Math.floor(point.y - r); y <= Math.ceil(point.y + r); y += 1) {
      for (let x = Math.floor(point.x - r); x <= Math.ceil(point.x + r); x += 1) {
        const w = Math.max(0, (membership(read.at(x + 0.5, y + 0.5), ref, target) - 0.3) / 0.7);
        mw += w;
        my += w * (y + 0.5);
        const tx = x - line.tile.x;
        const ty = y - line.tile.y;
        const cov = tx >= 0 && ty >= 0 && tx < line.tile.w && ty < line.tile.h ? line.tile.data[ty * line.tile.w + tx] : 0;
        const e = Math.max(0, (cov - 0.3) / 0.7);
        ew += e;
        ey += e * (y + 0.5);
      }
    }
    if (mw < 1 || ew < 1) {
      items.push({ kind: 'point', label: point.label, ok: false, errorPx: null, note: '数据点没量到' });
      continue;
    }
    const measuredY = point.y + (my / mw - ey / ew);
    const err = Math.abs(measuredY - predict(point.value));
    items.push({ kind: 'point', label: point.label, ok: err <= tol, errorPx: round(err, 2) });
  }
  return summarize(items, tol, '', { axisResidualPx: round(axisResidual, 2), ticks: measured.length });
}

function verifyPie(read, P) {
  const [cx, cy] = P.center;
  const rho = P.donut ? P.r0 + (P.r1 - P.r0) * 0.85 : P.r1 * 0.9;
  const tol = Math.max(1.5, rho * 0.004);
  const items = [];
  const total = P.values.reduce((sum, value) => sum + value, 0);
  const at = (angle) => read.at(cx + rho * Math.cos(angle), cy + rho * Math.sin(angle));
  const visible = P.wedges.map((w, i) => ({ ...w, i })).filter((w) => w.value > 0);
  // 扇形的颜色：在每个扇形两端里面一点取样（离分隔线和扇形里的数字都远）。
  const inset = (P.sepW + 4) / rho;
  for (const w of visible) {
    if (w.a1 - w.a0 < inset * 2 + 0.01) continue;
    for (const angle of [w.a0 + inset, w.a1 - inset]) {
      const d = colorDistance(at(angle), w.rgb);
      items.push({ kind: 'wedge', label: '第 ' + (w.i + 1) + ' 块', ok: d < 70, errorPx: null, note: d < 70 ? '' : '颜色不对' });
    }
  }
  // 扇形的边界：分隔线露出的是面板本身，分隔线的中心就是边界。期望的边界直接按数值算，不用画的时候的角度。
  if (visible.length > 1) {
    let acc = 0;
    P.values.forEach((value, i) => {
      const expected = -Math.PI / 2 + (2 * Math.PI * acc) / total;
      acc += value;
      if (value <= 0) return;
      const prevIndex = previousVisible(P.values, i);
      const own = P.wedges[i];
      const other = P.wedges[prevIndex];
      const near = (2.5 * Math.PI) / 180 + 4 / rho;
      let sw = 0;
      let sa = 0;
      const step = 0.25 / rho;
      for (let a = expected - near; a <= expected + near; a += step) {
        const c = at(a);
        const toOwn = colorDistance(c, own.rgb);
        const toOther = colorDistance(c, other.rgb);
        const span = Math.min(colorDistance(P.surface, own.rgb), colorDistance(P.surface, other.rgb));
        const sep = clamp(1 - colorDistance(c, P.surface) / Math.max(1, span), 0, 1);
        const w = toOwn > 30 && toOther > 30 ? Math.max(0, (sep - 0.25) / 0.75) : 0;
        sw += w;
        sa += w * a;
      }
      if (sw * step * rho < 0.5) {
        items.push({ kind: 'boundary', label: '第 ' + (i + 1) + ' 块的起点', ok: false, errorPx: null, note: '分隔线没量到' });
        return;
      }
      const err = Math.abs(sa / sw - expected) * rho;
      items.push({ kind: 'boundary', label: '第 ' + (i + 1) + ' 块的起点', ok: err <= tol, errorPx: round(err, 2) });
    });
  }
  return summarize(items, tol, '');
}

function previousVisible(values, i) {
  for (let k = 1; k <= values.length; k += 1) {
    const j = (i - k + values.length) % values.length;
    if (values[j] > 0) return j;
  }
  return i;
}

function summarize(items, tol, failNote, extra) {
  const bad = items.filter((item) => !item.ok);
  const errors = items.map((item) => item.errorPx).filter((value) => typeof value === 'number');
  const maxErrorPx = errors.length ? round(Math.max(...errors), 2) : null;
  const ok = !failNote && items.length > 0 && !bad.length;
  let note = failNote;
  if (!note) {
    note = ok
      ? '量回来 ' + items.length + ' 处，最大偏差 ' + (maxErrorPx === null ? 0 : maxErrorPx) + ' 像素（允许 ' + round(tol, 1) + '）'
      : bad
          .slice(0, 3)
          .map((item) => (item.kind === 'tick' ? '刻度 ' : item.kind === 'bar' ? '柱子 ' : item.kind === 'point' ? '数据点 ' : '') + item.label + '：' + (item.note || '差 ' + item.errorPx + ' 像素'))
          .join('；');
  }
  return { ok, note, checked: items.length, maxErrorPx, tolerancePx: round(tol, 2), failed: bad.slice(0, 6), ...(extra || {}) };
}

function linearFit(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    sxx += (xs[i] - mx) * (xs[i] - mx);
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  const a = sxx > 0 ? sxy / sxx : 0;
  return { a, b: my - a * mx };
}

function medianColor(colors) {
  return [0, 1, 2].map((k) => {
    const list = colors.map((c) => c[k]).sort((a, b) => a - b);
    return list[list.length >> 1];
  });
}

// ---------------------------------------------------------------- 小工具

function parseHex(value) {
  const hex = hexColor(value);
  if (!hex) return null;
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

export function toHex(rgb) {
  return '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function lumOf(rgb) {
  return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
}

function colorDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

function clampInt(value, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.round(value)));
}

function round(value, digits) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const k = 10 ** digits;
  return Math.round(value * k) / k;
}
