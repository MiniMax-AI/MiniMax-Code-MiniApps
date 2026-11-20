// 各模型节点（规划、评审、修正、选优、追问编辑、跨图评审、动图评审、参考图判定）调用工具的上限。
//
// 以前是写死的（规划 10、评审 6、修正 4、追问编辑 4……），简单的图和难的图给一样多。
// 24 个真机会话的实测：追问编辑 5 次里 4 次撞到上限 4 被打断，修正 3 次全撞到上限 4，
// 评审 64 次里 6 次撞到上限 6（都是 324 字的长卷、15 段字的课本页这类难的图）；
// 规划反过来，24 次里 18 次一次工具都没用。
//
// 现在每次调用前现算：
//   上限 = 必须打开的图（每个候选的看图材料、参考图材料……）
//        + 1 次（几乎每个节点都会先跑一次 run_code 看看文件，实测 64 次评审里有 88 次 run_code）
//        + 按难度给的余量（规划给每张图判 easy / normal / hard；没判就按规格推断，见 inferDifficulty）
//        + 这个节点在这张图上撞过几次上限，就再多给几个 2 次。
// 余量按评审的实测定：用掉的次数减去必须打开的图，中位 1、p75 2、p90 3、最多 5（被上限截断，实际要的更多）。
// 加上那 1 次，easy 给 1 正好到 p75，normal 给 2 到 p90，hard 给 4 到实测最大。
// 每个节点另有封顶，免得一个节点在难图上无限翻文件。超了照旧在运行时中断、强制收尾（agent.mjs）。

export const DIFFICULTIES = new Set(['easy', 'normal', 'hard']);
export const DIFFICULTY_LABELS = { easy: '简单', normal: '一般', hard: '难' };
const SLACK = { easy: 1, normal: 2, hard: 4 };
const ORDER = { easy: 0, normal: 1, hard: 2 };
const OVERHEAD = 1;
const RAISE = 2;
export const TOOL_CAPS = { plan: 12, think: 3, judge: 12, refine: 10, select: 6, edit: 12, cross: 8, frames: 10, tweenplan: 6, tweens: 8 };

export function normalizeDifficulty(value) {
  const level = String(value || '').trim().toLowerCase();
  return DIFFICULTIES.has(level) ? level : '';
}

function texts(list) {
  return (list || []).map((item) => (typeof item === 'string' ? item : (item && item.text) || '')).join('');
}

// 规划没判难度时按规格推断。只看规格里写得出来的东西：字多不多、要不要对照参考图、动图帧数、图表数、硬性条目数。
export function inferDifficulty(spec) {
  const s = spec || {};
  const layers = (s.textOverlay && s.textOverlay.layers) || [];
  const chars = texts(s.textLayers && s.textLayers.length ? s.textLayers : layers).replace(/\s/g, '').length;
  const refs = (s.refs || []).length + (s.characterRefs || []).length;
  const frames = s.animation && Array.isArray(s.animation.frames) ? s.animation.frames.length : 0;
  const charts = (s.charts || []).length;
  const hardItems = (s.checklist || []).filter((item) => item && item.kind === 'hard' && item.verify !== 'program').length;
  const qr = (s.qrCodes || []).length;
  const hard = [];
  if (layers.length >= 8) hard.push(layers.length + ' 段文字');
  else if (chars >= 120) hard.push(chars + ' 个字');
  if (refs >= 2) hard.push('要对照 ' + refs + ' 张参考图');
  if (frames >= 8) hard.push('动图 ' + frames + ' 帧');
  if (charts >= 2) hard.push(charts + ' 张图表');
  if (hardItems >= 6) hard.push(hardItems + ' 条硬性要求');
  if (hard.length) return { level: 'hard', reason: hard.join('、') };
  if (!refs && !chars && !frames && !charts && !qr && hardItems <= 3) return { level: 'easy', reason: '没有参考图、文字、图表，要求不多' };
  return { level: 'normal', reason: '' };
}

// 这张图的难度：规划判的优先，没判就推断。
export function difficultyOf(image) {
  const spec = (image && image.spec) || {};
  const own = normalizeDifficulty(spec.difficulty);
  if (own) return { level: own, reason: spec.difficultyReason || '', source: 'plan' };
  return { ...inferDifficulty(spec), source: 'inferred' };
}

// 一次照顾好几张图的节点（追问编辑、跨图评审）按其中最难的那张算。
export function hardestOf(images) {
  let best = { level: 'easy', reason: '', source: 'inferred' };
  for (const image of images || []) {
    const one = difficultyOf(image);
    if (ORDER[one.level] > ORDER[best.level]) best = one;
  }
  return best;
}

// needs：[{ count, what }]，这个节点必须打开的东西。fixed：只给必须的那份，不按难度加（参考图判定只看一张拼图）。
// 返回 { limit, note }：limit 直接给 runJson 的 maxTools，提示词里写同一个数；note 写进时间线，说明这个数怎么来的。
export function toolBudget(step, options) {
  const o = options || {};
  const needs = (o.needs || []).filter((item) => item && item.count > 0);
  const need = needs.reduce((sum, item) => sum + item.count, 0);
  const level = DIFFICULTIES.has(o.difficulty) ? o.difficulty : 'normal';
  const slack = o.fixed ? 0 : SLACK[level];
  const hits = o.fixed ? 0 : Math.max(0, Number(o.hits) || 0);
  const cap = TOOL_CAPS[step] || 10;
  const raw = need + OVERHEAD + slack + hits * RAISE;
  const limit = Math.max(1, Math.min(cap, raw));
  const parts = needs.map((item) => item.what + ' ' + item.count);
  parts.push('余量 ' + OVERHEAD);
  if (slack) parts.push('难度' + DIFFICULTY_LABELS[level] + ' ' + slack);
  if (hits) parts.push('之前撞过 ' + hits + ' 次上限 ' + hits * RAISE);
  return { limit, note: parts.join(' + ') + ' = ' + raw + (raw > cap ? '，封顶 ' + cap : '') + ' 次' };
}

// 节点跑完撞没撞上限，记在图（或会话）上：同一个节点下次多给。
export function noteToolHit(target, step, result) {
  if (!target || !result || !result.overBudget) return;
  target.toolHits = { ...(target.toolHits || {}) };
  target.toolHits[step] = (target.toolHits[step] || 0) + 1;
}

export function hitsOf(target, step) {
  return (target && target.toolHits && target.toolHits[step]) || 0;
}
