// H3-Image-Executor 状态机：00 输入 -> 01 分诊 -> 02 THINK/检索 -> 03 PLAN -> 04 PAINT
// -> 05 VERIFY（程序检查 + 色偏校正 + VLM 评审）-> 06 REFINE -> 07 DELIVER -> 08 增量编辑。
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import * as h3 from './h3.mjs';
import * as png from './png.mjs';
import * as review from './review.mjs';
import { searchRefImages, normalizeRefQueries, broadenQuery } from './refsearch.mjs';
import { DIFFICULTY_LABELS, difficultyOf, hardestOf, hitsOf, normalizeDifficulty, noteToolHit, toolBudget } from './budget.mjs';
import { createRefCache } from './refcache.mjs';
// 接口返回的不一定是 PNG：实测同一个端点有时回 JPEG。只用 png.decodePng 会让整条
// 程序校验链路（尺寸 / 色偏 / 锐度 / 预览图 / 评审看图材料）在 JPEG 响应下静默失效，
// 而图照样交付——用户看到的是「已交付」，看不到「其实一项都没验」。
import { decodeImage, extensionFor, sniffFormat } from './image.mjs';
import { detail, group, kv, list, seconds, text, thumbs } from './detail.mjs';
// 二维码：生图模型画不出能扫的码，图里要放码时由程序生成真码、贴回原位、从最终文件扫码验证。
import { fixQrInImage } from './qrfix.mjs';
// 文字：长段文字、竖排、书法让模型直接画很容易写残，这类图让模型画无字底图，文字由程序按原文排进去。
import { normalizePart, overlayText, textRisk } from './textoverlay.mjs';
import { isCjk, isPunct } from './textlayout.mjs';
import { FONT_KINDS, describeFontKinds, normalizeFontKind } from './fonts.mjs';
// 图表：生图模型画不准柱子高矮、刻度和数字。图里要放数据图表时，模型只画留出空白面板的底图，
// 图表由程序按数据画进去，再从最终文件量回来核对（chart.mjs）。
import { CHART_TYPES, MAX_CHARTS, chartDataCheck, describeChart, normalizeChart, normalizeCharts, overlayCharts } from './chart.mjs';
import {
  animationInventory,
  applyAnimationOps,
  awaitingInfo,
  confirmTarget,
  deliverAnimation,
  ensureState as ensureAnimationState,
  hasAdjustments as hasAnimationAdjustments,
  isAnimation,
  normalizeAnimation,
  normalizeAnimationOps,
  resetForNewReference,
  runFrames,
  transitionOf,
  usesGivenReference,
} from './animation.mjs';
// 程序转圈：绕中心转的动画（加载圈、转动的图标）只画一张图，由程序转出各帧（motiongif.mjs）。
import {
  composeMotionGif,
  mergeMotionOps,
  motionGifInventory,
  motionGifItem,
  normalizeMotionGif,
} from './motiongif.mjs';
// 组图拼 GIF：分格的组图由程序切格、按节奏拼成 GIF，不再调生图（panelgif.mjs）。
import {
  bounceAsked,
  composePanelGif,
  mergePanelOps,
  normalizePanelGif,
  panelGifInventory,
  panelGifItem,
} from './panelgif.mjs';
// 组图 GIF 的过渡格：相邻两格之间补一格中间状态，一起生成、从候选里挑（paneltween.mjs）。
import { ensurePanelTweens } from './paneltween.mjs';

export const DEFAULTS = {
  area: '4K',
  candidates: 2,
  maxRefine: 5,
  maxRefineFast: 1,
  maxFullEdits: 2,
  previewEdge: 1024,
  staleActionRounds: 2,
  staleStopRounds: 3,
  // 反过度评审：hard 项越多，评审越容易挑刺、越容易打回。
  // 8 = 最多 4 条文字层项 + planner 写的 4 条语义项。原来只有 5，文字层一多
  // （真机 20261110-5e10ae 手语字母表 26 个字母标签）就把 planner 写的「手型对不对」
  // 全部挤成 soft，而 soft 不参与放行——图就这样放行了。
  maxHardItems: 8,
  // 各节点的工具调用上限不再写死，每次调用前按任务难度现算（见 budget.mjs），超了运行时硬中断。
  // 看图材料长边上限：再大 VLM 也会缩，反而拖慢上传与推理。
  sheetMaxEdge: 1568,
  // 多图并行上限。每张图同一时刻最多占 1 个 agent 运行槽（runJson 每次都开新会话），
  // 所以这里必须和 miniapp/miniapp.json 的 agentConcurrency 对齐：取它的一半，
  // 另一半留给同时跑的第二个会话、角色基准图和跨图评审。改任一边都要改另一边，
  // h3-concurrency-test.mjs 会校验这两个数的关系。
  // 注意 agentConcurrency 属于 Mini App 清单（miniapp/miniapp.json），不是
  // .minimax-plugin/plugin.json——写进后者会被社区校验器判成未知字段，而且完全不生效。
  // 实测瓶颈 95% 在 judge（VLM 评审，均 367s/次），paint 只要 16s，所以放开并行直接砍耗时。
  imageConcurrency: 4,
  refDownloadLimit: 8,
  // 参考图：一批先下 3 张判定，不合格再取下一批；池子空了就换个说法再搜。
  refBatch: 3,
  refGateRounds: 3,
  refSearchRounds: 2,
  // 检索预算：一次规划（或一次追问）里，搜图工具调用和候选判定两样合计的上限。规划可以在
  // ref_budget 里自己定（0 = 不检索），没写就用 refBudgetDefault。refBudgetMax 是硬上限：
  // 6 项 × 每项最多 3 批判定 + 2 次换说法重搜，不封顶的话一次规划能花掉 30 次以上。
  refBudgetDefault: 8,
  refBudgetMax: 16,
  // 生图接口临时故障、手上还一张图都没有时，等多久再试下一轮。
  outageWaitMs: 30000,
  // 评审回合没跑成时，等多久重新评审同一批图。
  judgeRetryWaitMs: 15000,
};

// ---------------------------------------------------------------- prompt 槽位
// 第一层扩写不再让 planner 自由发挥，而是填固定槽位、由 harness 拼装。
// 好处：长度与覆盖面可控，必填项缺了能立刻发现并兜底，不同图之间的描述粒度一致。
// 顺序刻意模仿摄影描述的习惯：风格 → 景别 → 构图 → 场景 → 主体 → 材质 → 光线 → 镜头。
const SLOT_SPEC = [
  { key: 'style', label: '风格', required: true, fallback: '高质量写实摄影，色调自然' },
  { key: 'shot', label: '景别', required: true, fallback: '中景' },
  { key: 'composition', label: '构图', required: true, fallback: '主体突出，构图均衡，视线有落点' },
  { key: 'scene', label: '场景', required: true, fallback: '与主体相符的真实环境，背景干净不抢主体' },
  { key: 'subject', label: '主体', required: true, fallback: '' },
  { key: 'material', label: '环境材质', required: false, fallback: '' },
  { key: 'light', label: '光线', required: true, fallback: '自然光，方向明确，主体面部清晰、曝光准确' },
  { key: 'lens', label: '镜头', required: true, fallback: '35mm 等效焦段、f/2.8，主体在焦内，背景轻微虚化' },
];

// 色彩是 DiT 最容易翻车、评审又看不出来的一维，而程序级配平救不回来：
// 子图比父图亮时三通道增益会一起撞到 clamp 下限（实测 [0.75,0.75,0.75]），
// 退化成整体压暗。所以改成在扩写阶段就把白平衡写成硬要求，出图后只检测、不动像素。
const COLOR_CLAUSE =
  '色彩要求：整体白平衡中性准确，红绿蓝三通道均衡，不要整体偏红、偏暖或偏黄；' +
  '肤色与中性物体（白车、灰石、柏油、白墙）必须还原真实中性，红通道不得明显压过绿蓝通道。';

// 重画时追加的一句：告诉模型上一轮哪里不对。只加一次，避免多轮叠加成复读机。
const COLOR_RETRY_CLAUSE =
  '（上一轮输出整体偏红，这一轮必须修正白平衡：红通道降到与绿蓝相当，不要暖黄、橘红、粉红倾向，' +
  '画面里的中性物体必须还原成真实中性色。）';
const COLOR_RETRY_CLAUSE_WARM =
  '（上一轮画面里中性的地方（白、灰、黑）偏红，这一轮必须把它们还原成真实中性；需求要的黄、红、橙主色保持不变。）';

function withColorRetry(prompt, warm) {
  const base = String(prompt || '').trim();
  if (base.includes('上一轮输出整体偏红') || base.includes('上一轮画面里中性的地方')) return base;
  return base + (warm ? COLOR_RETRY_CLAUSE_WARM : COLOR_RETRY_CLAUSE);
}

// 需求本身就要大面积的黄、红、橙（明黄底的海报、大红的喜庆主题）：按「红绿蓝均衡、不要偏暖发黄」去要求，
// 等于让模型把需求要的颜色改淡；整图均值也判不了偏红——明黄的 redGain 天生接近 2（真机 20261116-d46325：
// 12 张候选 11 张判偏红，两轮没评审就重画，最后交付的那张也因此标「未通过」）。
const WARM_RE =
  /(明黄|鲜黄|亮黄|柠檬黄|金黄|黄色|橙色|橘色|橙黄|橘黄|红色|大红|朱红|猩红|正红|酒红|暖色|暖调|金色)[^，。；,;]{0,8}(背景|主色|主调|底色|色调|为主|铺满|大面积)|(以|用)[^，。；,;]{0,6}(明黄|黄色|橙色|红色|暖色|金色)[^，。；,;]{0,4}(为主|做底|铺底|打底)/;

function warmPalette(text) {
  return WARM_RE.test(String(text || ''));
}

function imageWarm(session, image) {
  const slots = (image && image.spec && image.spec.slots) || {};
  return warmPalette([session && session.instruction, slots.style, slots.scene].filter(Boolean).join(' '));
}

const COLOR_CLAUSE_WARM =
  '色彩要求：画面的主色按需求来，大面积的黄、红、橙是有意的配色，不要改淡、改冷；' +
  '白、灰、黑这些中性的地方保持中性，肤色真实，不要额外罩一层红色或橙色的滤镜。';

// 暖色设计的风格槽位里去掉「不要暖黄调」「不偏暖」这类要求：规划按 5b 的惯例写进去（真机 20261116-d46325 的明黄海报），
// 和需求要的主色打架。只去掉这一句，别的白平衡说法（中性的地方保持中性）留着。
function stripWarmStyle(text) {
  return String(text || '')
    .replace(/[，、；,;]?\s*(?:不要|别|不)(?:整体)?(?:偏)?暖(?:黄)?(?:调|色调)?(?=[，。；、,;]|$)/g, '')
    .replace(/^[，、；,;\s]+/, '');
}

// 暖色设计的排除项里去掉「偏红、偏暖发黄」：规划按惯例写进去的这条，正好和需求要的主色打架。
function stripWarmNegative(text) {
  return String(text || '')
    .replace(/(?:不要)?整体偏红[、，]?偏暖发黄/g, '')
    .replace(/(?:不要)?(?:整体)?(?:偏暖发黄|偏红|偏暖|发黄)(?=[、，；;。]|$)/g, '')
    .replace(/^[、，；;\s]+|[、，；;\s]+$/g, '')
    .replace(/([、，；;])[、，；;\s]+/g, '$1');
}

// 白纸、白底：需求写明是白色的纸面或背景时，白色的地方必须是中性的白。
const WHITE_RE = /白色(?:的)?(?:纸|纸张|纸面|背景|底|底色|卡纸|墙面?|页面|画布)|白纸|白底|纯白|白墙|white\s+(?:background|paper)/i;
// 门槛 4 级：真机 41535c 前三轮的纸面差 0.1 / 1.7 / 3.2 级都还看着白，交付那张 5.1 级就被看出发紫了。
const WHITE_CAST_LIMIT = 4;
const WHITE_MIN_SHARE = 0.04;
const WHITE_CHECK = {
  id: 'H-white',
  kind: 'hard',
  verify: 'program',
  text: '要求是白色的纸面或背景：白色的地方必须是中性的白，程序实测红绿蓝相差不超过 ' + (WHITE_CAST_LIMIT - 1) + ' 级',
};
const WHITE_RETRY_MARK = '（上一轮白色的纸面或背景';

// 米白、暖白、乳白、象牙白这类本来就带颜色的白不是中性白，不按白纸查：规划写的「浅暖白纸面」
// 以前也会触发这条检查（真机 20261117-f57a0f），把有意偏暖的纸面判成偏色。
// 「空白纸面」「留白」说的是没有东西，不是颜色，也先去掉。
const TINTED_WHITE_RE = /(?:空|留|米|暖|乳|奶|象牙|牙|蛋壳|珍珠|月|本|灰|米黄|暖调|偏暖)白/g;

function wantsWhite(session, image) {
  const slots = (image && image.spec && image.spec.slots) || {};
  const words = [...qrSources(session), slots.scene, slots.style, slots.subject].filter(Boolean).join(' ').replace(TINTED_WHITE_RE, '');
  return WHITE_RE.test(words);
}

function withWhiteCheck(checklist, on) {
  const rest = (checklist || []).filter((item) => item.id !== WHITE_CHECK.id);
  return on ? rest.concat({ ...WHITE_CHECK }) : rest;
}

// 白色往哪边偏：看最高和最低的通道。
function whiteCastLabel(rgb) {
  if (!rgb) return '偏色';
  const names = ['R', 'G', 'B'];
  const hi = names[rgb.indexOf(Math.max(...rgb))];
  const lo = names[rgb.indexOf(Math.min(...rgb))];
  const table = { RB: '偏暖发黄', RG: '偏粉红', BR: '偏冷发蓝', BG: '偏粉紫', GR: '偏青绿', GB: '偏黄绿' };
  return table[hi + lo] || '偏色';
}

function withWhiteRetry(prompt, label) {
  const base = String(prompt || '').trim();
  if (base.includes(WHITE_RETRY_MARK)) return base;
  return base + WHITE_RETRY_MARK + (label ? label : '偏色') + '，这一轮必须还原成纯净中性的白：红绿蓝三个通道相等，不要发灰、发紫、发粉、发黄、发蓝。）';
}

// ---------------------------------------------------------------- 二维码
//
// 生图模型画不出能扫的二维码，它画的只是长得像码的黑白方块（真机 20261111-606a7e：两张候选
// 一个都扫不出，评审只核对了「像不像二维码」就放行）。所以分工是：
// - 规划节点只负责把码里要放的内容从用户原话里逐字抄下来（qr_codes），并在 prompt 里要求模型
//   画一个正对镜头、白底黑块、定位方块完整的占位码；
// - 每张候选出图后，程序找到这个占位码，生成真码贴回原位，再从最终文件扫码验证（qrfix.mjs）；
// - 扫不出就是 H-qr 硬项不通过，和别的硬项一样打回重画。
// 用户要码但没给内容时照常出图，交付时注明是装饰码；用户在同一会话里补一句内容，直接在原图上换。
const MAX_QR_CODES = 3;
// 允许规划节点在逐字抄下的内容前面补一个协议头（用户写 www.minimax.cn，码里放 https://www.minimax.cn），
// 其余一律要求逐字出现在用户说过的话里：码扫出一个用户没说过的网址，比扫不出更糟。
const QR_SCHEMES = /^(https?:\/\/|tel:|mailto:|smsto:|sms:)/i;

const QR_CLAUSE =
  '二维码：画面里的二维码只需画出占位图案，之后会由程序换成能扫的真码。' +
  '要求是正对镜头的平整正方形，纯白底上的黑色方块，左上、右上、左下三个角的回字形定位方块完整清晰，' +
  '码的四周留出一圈白边，不要被手、文字或其它物体遮挡，不要弯折、倾斜过大或做成艺术化变形，中间不要放 logo，' +
  '边长不小于画面短边的六分之一。';

// 编辑已有图时用：上一版的码已经是真码，模型重画会把它画坏，程序之后会再贴一次。
const QR_KEEP_CLAUSE = '画面里的二维码保持原来的位置、大小和白底，不要遮挡、删除或改画它。';

const QR_RETRY_MARK = '（上一轮画面里的二维码没法换成真码';

function withQrRetry(prompt, reason) {
  const base = String(prompt || '').trim();
  if (base.includes(QR_RETRY_MARK)) return base;
  return (
    base +
    QR_RETRY_MARK +
    (reason ? '：' + reason : '') +
    '。这一轮必须把二维码画大、画正：正对镜头的平整正方形，白底黑块，三个角的回字形定位方块完整清晰，' +
    '四周留出白边，不要被任何东西挡住。）'
  );
}

// 用户在这个会话里说过的所有话：首轮需求、出图前确认的回答、之后每一轮追问。
function qrSources(session, extra) {
  return [
    session.instruction,
    ...(session.answered || []).map((item) => item && item.answer),
    ...(session.turns || []).map((turn) => turn && turn.instruction),
    ...(extra || []),
  ]
    .filter(Boolean)
    .map(String);
}

// 逐字核对必须按「整段」找，不能只看子串：规划把 https://www.minimax.cn/ 写成 https://minimax.cn，
// 去掉协议头的 minimax.cn 恰好是原话的子串；把 www.minimax.cn/about 截成 www.minimax.cn 也一样。
// 所以找到的位置前后不能紧挨着网址字符。括号、引号、中文、空白都算边界（用户常写「（[网址]）」），
// 句末的 . , : ; ! ? 后面再没有网址字符时也算边界（「我的网站是 www.minimax.cn.」）。
// 开头只防「丢了前缀」（www.、子域名、user@），所以 : = 这类标签分隔符不算（「官网:https://…」）。
const TOKEN_CHAR = /[A-Za-z0-9\-._~/:?#@%=&+]/;
const LEAD_CHAR = /[A-Za-z0-9\-._~/@%]/;

function foundAsToken(source, needle) {
  if (!needle) return false;
  for (let at = source.indexOf(needle); at >= 0; at = source.indexOf(needle, at + 1)) {
    const before = at > 0 ? source[at - 1] : '';
    const after = source[at + needle.length] || '';
    const afterNext = source[at + needle.length + 1] || '';
    const startOk = !before || !LEAD_CHAR.test(before) || !TOKEN_CHAR.test(needle[0]);
    const endOk =
      !after ||
      !TOKEN_CHAR.test(after) ||
      !TOKEN_CHAR.test(needle[needle.length - 1]) ||
      (/[.,:;!?]/.test(after) && (!afterNext || !TOKEN_CHAR.test(afterNext)));
    if (startOk && endOk) return true;
  }
  return false;
}

function isVerbatim(content, sources) {
  if (!content) return false;
  if (sources.some((source) => foundAsToken(source, content))) return true;
  const bare = content.replace(QR_SCHEMES, '');
  return bare !== content && bare.length >= 3 && sources.some((source) => foundAsToken(source, bare));
}

// 规划节点给的 qr_codes 归一成 [{ content, where, verbatim }]。content 只去掉首尾空白，
// 中间一个字符都不动；空内容表示「要一个码，但用户没说放什么」（装饰码）。
function normalizeQrCodes(raw, sources) {
  const rows = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const item of rows) {
    let content = '';
    let where = '';
    if (typeof item === 'string') content = item;
    else if (item && typeof item === 'object') {
      content = item.content === undefined || item.content === null ? '' : String(item.content);
      where = String(item.where || '').trim().slice(0, 60);
    } else continue;
    content = content.trim();
    out.push({ content, where, verbatim: content ? isVerbatim(content, sources) : false });
  }
  return out.slice(0, MAX_QR_CODES);
}

// 要贴真码的内容：有内容、而且逐字核对过。
function qrContents(spec) {
  return ((spec && spec.qrCodes) || []).filter((item) => item.content && item.verbatim).map((item) => item.content);
}

function qrCheckItem(contents) {
  return {
    id: 'H-qr',
    kind: 'hard',
    verify: 'program',
    text: '画面里的二维码扫出来是「' + contents.join('」「') + '」（程序贴真码后从最终文件扫码实测）',
  };
}

// 清单里挂上（或摘掉）H-qr。放在 hard 上限裁剪之外，否则会被降级成 soft，soft 不参与放行。
function withQrCheck(checklist, qrCodes) {
  const contents = qrContents({ qrCodes });
  const rest = (checklist || []).filter((item) => item.id !== 'H-qr');
  return contents.length ? rest.concat(qrCheckItem(contents)) : rest;
}

// 交付时每张图的二维码状况：给页面显示，也决定要不要请用户补内容。
function qrDelivery(image, chosen) {
  const codes = (image.spec && image.spec.qrCodes) || [];
  if (!codes.length) return null;
  const fixed = (chosen && chosen.program && chosen.program.qr) || null;
  const items = codes.map((code) => {
    if (!code.content) return { content: '', status: 'decorative', note: '装饰码，扫不出内容' };
    if (!code.verbatim) {
      return { content: code.content, status: 'unverified', note: '这段内容在你的原话里找不到，没有贴真码' };
    }
    const hit = fixed && (fixed.items || []).find((item) => item.content === code.content);
    if (hit && hit.ok) return { content: code.content, status: 'real', note: '已换成真码，扫码实测通过' };
    // 在原图上换码没成功时，图还是上一版，原因记在 qrAttempt 上。
    const attempt =
      image.qrAttempt && (image.qrAttempt.contents || []).includes(code.content) ? image.qrAttempt.reasonText : '';
    return {
      content: code.content,
      status: 'failed',
      note: hit ? hit.reasonText + (hit.detail ? '（' + hit.detail + '）' : '') : attempt || '没有做二维码替换',
    };
  });
  return { items };
}

// 交付里要请用户处理的二维码问题。只挂在这一版交付上，不写进 session.questions：
// 用户补了内容、码换好之后，下一版交付就不该再提。
function qrQuestions(image, info) {
  if (!info) return [];
  const out = [];
  const decorative = info.items.filter((item) => item.status === 'decorative');
  const unverified = info.items.filter((item) => item.status === 'unverified');
  const failed = info.items.filter((item) => item.status === 'failed');
  if (decorative.length) {
    out.push(
      image.id + ' 里的二维码是装饰图案，扫不出内容。把要放的链接或文字在这个会话里发给我，' +
        '我直接在原图上换成能扫的真码，不重新画',
    );
  }
  for (const item of unverified) {
    out.push(
      image.id + ' 的二维码内容「' + item.content + '」在你说过的话里找不到，没有贴真码。' +
        '确认要放的内容后在这个会话里发给我，我直接在原图上换',
    );
  }
  for (const item of failed) {
    out.push(image.id + ' 的二维码没能换成「' + item.content + '」（' + item.note + '）。可以回复「重画」重新生成这张图');
  }
  return out;
}

// ---------------------------------------------------------------- 程序排字
//
// 生图模型写长段文字、竖排、书法时很容易写残（真机 20261113-01b902：324 字的《兰亭集序》长卷，第一轮的
// 候选有臆造字，交付的那张漏了 36 个字，评审看不清 324 个字，只能判「拿不准」放行）。兜底做法：模型只画一张不带字的底图，
// 文字由程序用字体按原文逐字排进去（textoverlay.mjs）。分工是：
// - 规划节点给每个文字层写好放在哪、横排还是竖排、什么书体（text_overlay），以及「载体留空」版本的槽位；
// - 字多、竖排、书法这类一开始就走这条路；短标题先让模型直接画，评审判出文字画残了再切过来；
// - 每张候选出图后，程序在规划的位置附近找到留空的载体，把字排进去；没留空就是 H-text 不通过，带着原因重画。
// 一张课本内页就有课题、拼音、两三段正文、脚注、页码，8 段不够用（真机 20261116-41535c 规划了 9 段，页码被丢了）。
const MAX_TEXT_LAYERS = 16;
const TEXT_DIRECTIONS = new Set(['horizontal', 'vertical']);
const TEXT_ALIGNS = new Set(['start', 'center', 'end']);
const TEXT_PUNCTUATION = new Set(['inline', 'side', 'omit']);
const TEXT_ROLES = new Set(['title', 'subtitle', 'body', 'footnote', 'caption', 'label', 'page', 'pinyin']);
const BASE_SLOT_KEYS = new Set([...SLOT_SPEC.map((spec) => spec.key), 'negative']);

const BLANK_MARK = '文字留白：';
const TEXT_RETRY_MARK = '（上一轮底图上预留给文字的地方没有留空';

const TEXT_HARD_CHECK = {
  id: 'H-text',
  kind: 'hard',
  verify: 'program',
  text: '文字由程序逐字排进底图上留空的位置：位置上确实是空白、全部文字排得下、字号够大（程序实测）',
};
const NO_TEXT_CHECK = {
  id: 'H-notext',
  kind: 'hard',
  verify: 'vlm',
  text: '除程序排进去的文字以外，画面里没有别的文字、伪文字或乱码',
};
const TEXT_FIT_CHECK = {
  id: 'S-textfit',
  kind: 'soft',
  verify: 'vlm',
  text: '排进去的文字和画面融为一体：大小、位置、颜色和载体协调，像真的写在或印在上面，没有压边、出界或悬浮感',
};
const OVERLAY_CHECK_IDS = new Set([TEXT_HARD_CHECK.id, NO_TEXT_CHECK.id, TEXT_FIT_CHECK.id]);

function layerTexts(textLayers) {
  return (Array.isArray(textLayers) ? textLayers : [])
    .map((layer) => (typeof layer === 'string' ? layer : layer && layer.text))
    .filter(Boolean)
    .map(String);
}

function normalizeTextLayer(raw, text) {
  const item = raw && typeof raw === 'object' ? raw : {};
  const box =
    Array.isArray(item.box) && item.box.length === 4 && item.box.every((value) => Number.isFinite(Number(value)))
      ? item.box.map(Number)
      : null;
  const direction = TEXT_DIRECTIONS.has(item.direction) ? item.direction : 'horizontal';
  const color = String(item.color || '').trim();
  const role = TEXT_ROLES.has(String(item.role || '').trim().toLowerCase()) ? String(item.role).trim().toLowerCase() : '';
  const indent = Number(item.indent);
  return {
    text,
    box,
    direction,
    font: normalizeFontKind(item.font),
    color: /^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(color) ? (color.startsWith('#') ? color : '#' + color) : '',
    align: TEXT_ALIGNS.has(item.align) ? item.align : direction === 'vertical' ? 'start' : 'center',
    punctuation: direction === 'vertical' && TEXT_PUNCTUATION.has(item.punctuation) ? item.punctuation : direction === 'vertical' ? 'inline' : '',
    surface: String(item.surface || '').trim().slice(0, 40),
    // 同一角色的几层统一字号；body 首行缩进两字（indent 可改），footnote 上方画分隔线（rule:false 不画）。
    role,
    ...(Number.isInteger(indent) && indent >= 0 && indent <= 4 ? { indent } : {}),
    ...(item.rule === false ? { rule: false } : {}),
    // 部件分色：这一层每个汉字靠 side 那一侧的部件用另一种颜色（「清」的「氵」橙色），见 textlayout.splitTile。
    ...(normalizePart(item.part) ? { part: normalizePart(item.part) } : {}),
  };
}

// 规划没写这一层怎么排时，从用户原话、标题和槽位里猜：说了竖排就竖排，说了书法、毛笔就用毛笔字。
// 不猜的话一律是横排黑体，书法长卷会被排成一页横排的印刷体。
const SURFACE_WORDS = ['宣纸', '绢本', '洒金纸', '牌匾', '招牌', '黑板', '白板', '屏幕', '海报', '菜单', '书页', '信纸', '木板', '石碑'];

function inferTextLayer(hint) {
  const source = String(hint || '');
  const vertical = /竖排|竖写|竖向|直排|从上到下|自上而下/.test(source);
  const font = /行书|草书/.test(source)
    ? 'xing'
    : /书法|毛笔|楷书|行楷|隶书|篆书|手卷|条幅|中堂|对联|春联|题字/.test(source)
      ? 'brush'
      : /宋体|衬线/.test(source)
        ? 'song'
        : /楷体/.test(source)
          ? 'kai'
          : 'hei';
  const calligraphy = font === 'brush' || font === 'xing';
  return {
    direction: vertical ? 'vertical' : 'horizontal',
    font,
    punctuation: vertical && calligraphy && !/(带|加|保留|写上|要有|包含)标点/.test(source) ? 'omit' : undefined,
    surface: SURFACE_WORDS.find((word) => source.includes(word)) || '',
  };
}

// 规划给的 text_overlay 归一成 { use, base, layers, planned }。文字一律以 text_layers 为准：规划在 layers 里改了字、
// 少写了一层，都按 text_layers 补齐；对不上的按顺序配，配不上的按 hint 猜排法。没有文字层时返回 null。
// planned：规划自己写了排法。没写时只知道字，不知道该放在画面哪里。
function normalizeTextOverlay(raw, textLayers, hint) {
  const texts = layerTexts(textLayers);
  if (!texts.length) return null;
  const source = raw && typeof raw === 'object' ? raw : {};
  const rawLayers = Array.isArray(source.layers) ? source.layers : [];
  const used = new Set();
  const layers = texts.slice(0, MAX_TEXT_LAYERS).map((text, index) => {
    let hit = rawLayers.findIndex((item, i) => !used.has(i) && item && String(item.text || '').trim() === text.trim());
    if (hit < 0 && index < rawLayers.length && !used.has(index)) hit = index;
    if (hit >= 0) used.add(hit);
    return normalizeTextLayer(hit >= 0 ? rawLayers[hit] : inferTextLayer(hint), text);
  });
  const base = {};
  if (source.base && typeof source.base === 'object') {
    for (const [key, value] of Object.entries(source.base)) {
      if (!BASE_SLOT_KEYS.has(key)) continue;
      const textValue = asText(value);
      if (textValue) base[key] = textValue;
    }
  }
  // 排不下的层要记下来：以前多出来的悄悄丢掉，程序验的 T 项照样判「已逐字排入」。
  return { use: source.use === true, base, layers, planned: rawLayers.length > 0, dropped: texts.slice(MAX_TEXT_LAYERS) };
}

const percent = (value) => Math.round(Math.min(1, Math.max(0, Number(value) || 0)) * 100) + '%';

// 把规划的位置说成模型听得懂的话：「画面中央、从左 6% 到 94%、从上 16% 到 84% 的区域」。
function describeBox(box) {
  const b = Array.isArray(box) && box.length === 4 ? box : [0.1, 0.1, 0.9, 0.9];
  const cx = (b[0] + b[2]) / 2;
  const cy = (b[1] + b[3]) / 2;
  const h = cx < 0.38 ? '左' : cx > 0.62 ? '右' : '';
  const v = cy < 0.38 ? '上' : cy > 0.62 ? '下' : '';
  const where = !h && !v ? '中央' : v && h ? h + v + '方' : v ? (v === '上' ? '上方' : '下方') : h + '侧';
  return (
    '画面' + where + '从左 ' + percent(b[0]) + ' 到 ' + percent(b[2]) + '、从上 ' + percent(b[1]) + ' 到 ' + percent(b[3]) + ' 的区域'
  );
}

// 段落多时（课本页、菜单、说明书）按载体合并成一整片区域，只用方位词描述，不写数字：
// 逐段写「从左 11% 到 42%、从上 3% 到 5%」十几组，模型会把这些百分数当成要画的字，
// 画出一整页写满数字的表格（真机 20261116-06a562 第 4 轮，15 段文字、60 个数字）。
const BLANK_MERGE_OVER = 3;

function describeSpan(box) {
  const b = Array.isArray(box) && box.length === 4 ? box : [0.1, 0.1, 0.9, 0.9];
  const band = (y) => (y < 0.2 ? '顶部' : y < 0.4 ? '上部' : y < 0.6 ? '中部' : y < 0.8 ? '下部' : '底部');
  const top = band(b[1] + 0.01);
  const bottom = band(b[3] - 0.01);
  const vertical = top === bottom ? '画面' + top : '画面从' + top + '到' + bottom;
  const width = b[2] - b[0];
  const cx = (b[0] + b[2]) / 2;
  const horizontal = width >= 0.6 ? '横向几乎占满整幅' : cx < 0.4 ? '偏左' : cx > 0.6 ? '偏右' : '居中';
  return vertical + '、' + horizontal + '的整片区域';
}

function blankClause(layers) {
  const list = layers || [];
  let parts;
  if (list.length > BLANK_MERGE_OVER) {
    const groups = new Map();
    for (const layer of list) {
      const key = layer.surface || '';
      const b = Array.isArray(layer.box) && layer.box.length === 4 ? layer.box : [0.1, 0.1, 0.9, 0.9];
      const union = groups.get(key);
      groups.set(key, union ? [Math.min(union[0], b[0]), Math.min(union[1], b[1]), Math.max(union[2], b[2]), Math.max(union[3], b[3])] : b.slice());
    }
    parts = [...groups.entries()].map(([surface, box]) => (surface ? surface + '上' : '') + describeSpan(box));
  } else {
    parts = list.map((layer) => (layer.surface ? layer.surface + '上' : '') + describeBox(layer.box));
  }
  return (
    BLANK_MARK +
    parts.join('；') +
    '保持完全空白：平整干净，没有任何文字、字母、数字、标点、笔迹、墨迹、印章、落款、签名、界格线和装饰纹样，' +
    '这里的文字之后由程序排进去。画面其他地方也不要出现任何文字、伪文字或水印。'
  );
}

function withTextRetry(prompt, reason) {
  const base = String(prompt || '').trim();
  if (base.includes(TEXT_RETRY_MARK)) return base;
  return (
    base +
    TEXT_RETRY_MARK +
    (reason ? '：' + reason : '') +
    '。这一轮必须把这块区域留成完全空白、平整的载体表面，上面不要画任何字、笔迹、印章、花纹或界格线。）'
  );
}

// 不带字的底图 prompt：槽位换成规划写的「载体留空」版本，清掉图内文字，末尾追加留白要求。
function composeBasePrompt(spec, instruction) {
  const overlay = spec && spec.textOverlay;
  if (!overlay) return (spec && spec.prompt) || '';
  const grams = textGrams(overlay.layers);
  const base = overlay.base || {};
  const slots = { text: '' };
  let subjectLost = false;
  for (const key of BASE_SLOT_KEYS) {
    const own = base[key];
    const value = own !== undefined ? own : (spec.slots || {})[key];
    if (!value) continue;
    slots[key] = cleanBaseSlot(key, value, grams, own !== undefined);
    if (key === 'subject' && own === undefined) subjectLost = slots[key].length < String(value).length * 0.5;
  }
  // 主体缺了会拿用户原话兜底，原话里就是要排的那段字。沿用的主体删掉了一大半，说明它写的主要就是这段字
  // （书法作品、菜单、说明页），剩下的只有「不要落款」这类零碎，先说清楚主体是一张空白的载体。
  if (!slots.subject) slots.subject = blankSubject(overlay.layers);
  else if (subjectLost) slots.subject = blankSubject(overlay.layers) + '；' + slots.subject;
  const composed = composePrompt(slots, '', instruction, true, spec.qrCodes);
  return composed.prompt + blankClause(overlay.layers);
}

// 底图槽位的清理。规划常常只改写 subject，别的槽位沿用有字版本，里面「墨字与纸面反差明确、字口锐利」
// 「浓黑松烟墨」「共 324 字」这类分句会把模型往写字上引，删掉；说「没有 / 不要 / 留空」的分句本身就是留白要求，保留。
// 沿用的排除项例外：「不要错字、不要横排文字」说的是字怎么写，等于告诉模型这里有字，删掉（末尾的留白要求
// 已经说了不要任何字）。任何槽位里漏进了原文（连续 4 个汉字和文字层一样）的分句也删掉。
const TEXTY_CLAUSE =
  /墨字|墨迹|墨色|墨痕|浓墨|淡墨|松烟墨|字迹|字口|字形|字体|字样|字幅|字号|字位|字距|字间|列距|行距|单字|逐字|照写|漏字|错字|别字|标点|笔画|笔意|笔锋|书法|书写|写着|写有|写满|题字|题写|文字|汉字|诗文|正文|全文|落款|楷书|行书|行楷|草书|隶书|篆书|字帖|碑帖|印刷体|宋体|黑体|楷体|仿宋|艺术字|手写体|标语|印着|印有|刻着|刻有|横排|竖排|阅读顺序|首列|末列|第[一二三\d]+列|\d+\s*个?(?:字(?!母)|列)|\b(?:text|lettering|calligraphy|inscription|handwriting|typography|typeface|font)\b/i;
const NEGATED_CLAUSE = /没有|不要|不带|不含|不写|不出现|不能有|无任何|无字|空白|留空|留白|去掉|\bno\b|\bwithout\b/i;
// 「书法长卷」「书法手卷」里的书法说的是上面写了字，载体本身是长卷：只去掉这两个字，分句留下。
const CARRIER_PHRASE = /书法(?=长卷|手卷|作品|条幅|横幅|立轴|中堂|卷轴|册页|扇面)/g;

function textGrams(layers) {
  const grams = new Set();
  for (const layer of layers || []) {
    const chars = Array.from(String((layer && layer.text) || '')).filter((ch) => isCjk(ch) && !isPunct(ch));
    for (let i = 0; i + 4 <= chars.length; i += 1) grams.add(chars.slice(i, i + 4).join(''));
  }
  return grams;
}

// 排除项常把几条写在一句里（「不要文字、不要水印、不要多余的人」），整句删掉会把不相干的几条一起丢掉：
// 按否定词开头的条目拆开，只删说字的那几条。不以否定词开头的条目（「不要印刷体、宋体、黑体」里的宋体、黑体）跟着前一条走。
const NEGATIVE_ITEM_HEAD = /^\s*(?:不要|不能|不得|不出现|不许|避免|禁止|无|没有|no\b|without\b)/i;

function negativeItems(clause) {
  const groups = [];
  for (const part of clause.split(/(?<=、)/)) {
    if (!groups.length || NEGATIVE_ITEM_HEAD.test(part)) groups.push(part);
    else groups[groups.length - 1] += part;
  }
  return groups;
}

// planned：这个槽位是规划为底图专门写的，只删漏进来的原文。删完是空的槽位返回空串，由上层兜底。
function cleanBaseSlot(key, value, grams, planned) {
  const source = planned ? String(value) : String(value).replace(CARRIER_PHRASE, '');
  let clauses = source.match(/[^，,；;。！!？?\n]+[，,；;。！!？?\n]*/g) || [];
  if (key === 'negative' && !planned) clauses = clauses.flatMap(negativeItems);
  const kept = clauses.filter((clause) => {
    const bare = Array.from(clause).filter((ch) => isCjk(ch) && !isPunct(ch)).join('');
    for (const gram of grams) if (bare.includes(gram)) return false;
    if (planned || !TEXTY_CLAUSE.test(clause)) return true;
    return key !== 'negative' && NEGATED_CLAUSE.test(clause);
  });
  return kept.join('').replace(/[，,；;、\s]+$/, '').trim();
}

function blankSubject(layers) {
  const surfaces = dedupe((layers || []).map((layer) => layer.surface).filter(Boolean));
  return (surfaces.length ? '一张完全空白的' + surfaces.join('、') : '完全空白的载体表面') + '，上面没有任何文字、笔迹和图案';
}

// 进入程序排字模式之后，T 项（文字内容）改由程序验，并挂上 H-text、H-notext、S-textfit。
// 和 H-qr 一样挂在 hard 上限裁剪之后，否则会被降级成 soft。
// 编辑节点重写过的清单常常把 T 项丢了（真机 01b902 的追问轮只剩「补齐第 17 字」这类条目），按文字层补回来。
function overlayChecklist(checklist, textLayers) {
  let rest = (checklist || []).filter((item) => !OVERLAY_CHECK_IDS.has(item.id));
  if (!rest.some((item) => /^T\d+$/.test(item.id))) rest = textChecks(textLayers).concat(rest);
  rest = rest.map((item) => (/^T\d+$/.test(item.id) ? { ...item, verify: 'program' } : item));
  return rest.concat({ ...TEXT_HARD_CHECK }, { ...NO_TEXT_CHECK }, { ...TEXT_FIT_CHECK });
}

function overlayLayers(image) {
  return (image && image.spec && image.spec.textOverlay && image.spec.textOverlay.layers) || [];
}

function isOverlay(image) {
  return Boolean(image && image.textMode === 'overlay' && overlayLayers(image).length);
}

// 程序知不知道字该排在哪：规划（或编辑节点）写了位置；或者是长文、竖排、书法，字本身就是画面主体，
// 默认位置（画面中间 80%）就是载体中间的一大块。
function canPlaceText(image) {
  const overlay = image && image.spec && image.spec.textOverlay;
  if (!overlay || !overlay.layers.length) return false;
  return Boolean(overlay.planned) || textRisk(overlay.layers).high;
}

// 同上，也管 1.9.0 以前没有 textOverlay 的会话（按已有的文字层和原话推一遍）。给编辑节点标「位置未知」用。
function textPlaceable(session, image) {
  if (image.spec.textOverlay) return canPlaceText(image);
  const inferred = normalizeTextOverlay(null, image.spec.textLayers, [session.instruction, image.title].filter(Boolean).join(' '));
  return Boolean(inferred) && textRisk(inferred.layers).high;
}

// 这一轮送进模型的完整 prompt：程序排字模式下用不带字的底图版本。
function promptFor(image) {
  return isOverlay(image) && image.spec.basePrompt ? image.spec.basePrompt : image.spec.prompt;
}

function enterOverlay(session, image, reason) {
  image.textMode = 'overlay';
  image.textReason = reason || image.textReason || '';
  image.spec.basePrompt = composeBasePrompt(image.spec, session.instruction);
  image.spec.checklist = overlayChecklist(image.spec.checklist, image.spec.textLayers);
}

// 字体出了问题（缺字、找不到字体）时程序排不了字，回到让模型直接画。
function leaveOverlay(image) {
  image.textMode = '';
  image.spec.checklist = (image.spec.checklist || [])
    .filter((item) => !OVERLAY_CHECK_IDS.has(item.id))
    .map((item) => (/^T\d+$/.test(item.id) ? { ...item, verify: 'vlm' } : item));
}

function textFailText(summary) {
  const failed = ((summary && summary.items) || []).filter((item) => !item.ok);
  if (!failed.length) return '未知原因';
  return dedupe(failed.map((item) => item.reasonText + (item.detail ? '（' + item.detail + '）' : ''))).join('；');
}

function fontLabelOf(summary) {
  return dedupe(((summary && summary.items) || []).map((item) => item.font)).join('、');
}

// 字数不算标点和空白：用户说「全文 324 字」时数的就是这个。
function shortText(value, limit) {
  const chars = Array.from(String(value || ''));
  const max = limit || 24;
  if (chars.length <= max) return chars.join('');
  const count = chars.filter((ch) => !/\s/.test(ch) && !isPunct(ch)).length;
  return chars.slice(0, max).join('') + '…（共 ' + count + ' 字）';
}

const PUNCTUATION_LABELS = { omit: '标点不写', side: '标点写在字旁' };

function layoutSummary(item) {
  if (!item || !item.ok) return '';
  const shape =
    item.direction === 'vertical'
      ? '竖排 ' + item.cols + ' 列、每列最多 ' + item.rows + ' 字'
      : '横排 ' + item.lines + ' 行';
  const hasPunct = Array.from(String(item.text || '')).some((ch) => isPunct(ch));
  const marks = item.direction === 'vertical' && hasPunct && PUNCTUATION_LABELS[item.punctuation] ? '，' + PUNCTUATION_LABELS[item.punctuation] : '';
  const extras = [
    item.unified ? '和同类文字统一字号' : '',
    item.indent ? '首行空 ' + item.indent + ' 格' : '',
    item.superscripts ? item.superscripts + ' 个脚注符号排成上标' : '',
    item.rule ? '上方画了分隔线' : '',
    item.moved ? '规划位置不空，' + (item.moved > 0 ? '往下' : '往上') + '挪了画面高度的 ' + Math.abs(Math.round(item.moved * 1000) / 10) + '%' : '',
    item.part ? (item.part.ok ? PART_SIDE_TEXT[item.part.side] + '的部件用 ' + item.part.color : '部件分色没做成') + (item.part.note ? '（' + item.part.note + '）' : '') : '',
  ].filter(Boolean);
  return shape + '，字高约 ' + item.size + 'px' + marks + (extras.length ? '，' + extras.join('，') : '');
}

// 交付时每张图的文字状况：给页面显示。
function textDelivery(image, chosen) {
  if (!isOverlay(image)) return null;
  const summary = chosen && chosen.program && chosen.program.text;
  if (!summary) return { status: 'missing', note: '这一版没有排字', items: [] };
  return {
    status: summary.status,
    font: fontLabelOf(summary),
    note:
      summary.status === 'overlay'
        ? '文字由程序按原文逐字排入（' + fontLabelOf(summary) + '）'
        : '文字没排上：' + textFailText(summary),
    items: (summary.items || []).map((item) => ({
      text: shortText(item.text, 16),
      ok: Boolean(item.ok),
      font: item.font || '',
      layout: layoutSummary(item),
      note: item.ok ? '' : item.reasonText + (item.detail ? '（' + item.detail + '）' : ''),
    })),
  };
}

// ---------------------------------------------------------------- 数据图表
//
// 和程序排字一样的分工：规划写清每张图表的数据和位置（charts），模型只画一张在那个位置留出平整面板的底图，
// 每张候选出图后程序把图表按数据画上去、从最终文件量回来核对；面板没留空就是 H-chart 不通过，带着原因重画。
// 图表一律由程序画，不先让模型试：模型画出来的柱子高矮和刻度本来就对不上，评审也量不出来。
const CHART_MARK = '图表留白：';
const CHART_RETRY_MARK = '（上一轮底图上预留给图表的地方没有留空';
const CHART_DEFAULT_BOX = [0.08, 0.12, 0.92, 0.92];

const CHART_HARD_CHECK = {
  id: 'H-chart',
  kind: 'hard',
  verify: 'program',
  text: '数据图表由程序按数据画进底图留空的面板：坐标轴、刻度、数值标注和比例从最终文件量回来核对通过（程序实测）',
};
const NO_CHART_CHECK = {
  id: 'H-nochart',
  kind: 'hard',
  verify: 'vlm',
  text: '除程序画的图表以外，画面里没有模型自己画的图表、坐标轴、柱子、折线或乱码数字',
};
const CHART_FIT_CHECK = {
  id: 'S-chartfit',
  kind: 'soft',
  verify: 'vlm',
  text: '程序画的图表和画面协调：面板平整，图表没有被遮挡或裁切，配色和画面风格相配',
};
const CHART_CHECK_IDS = new Set([CHART_HARD_CHECK.id, NO_CHART_CHECK.id, CHART_FIT_CHECK.id]);
const CHART_PATCH_FIELDS = ['type', 'title', 'unit', 'categories', 'series', 'stacked', 'labels', 'y_min', 'y_max', 'box', 'surface', 'colors', 'decimals', 'font'];

function imageCharts(image) {
  return (image && image.spec && Array.isArray(image.spec.charts) && image.spec.charts) || [];
}

function hasCharts(image) {
  return imageCharts(image).length > 0;
}

// 规划（或编辑节点）写的图表归一，并核对每个数是不是用户给的。
function chartsWithCheck(list, sources) {
  const text = sources.join('\n');
  return list.map((chart) => ({ ...chart, check: chartDataCheck(chart, text) }));
}

function chartClause(charts) {
  const parts = charts.map((chart) => (chart.surface ? chart.surface + '，' : '一块平整的浅色面板，') + describeBox(chart.box || CHART_DEFAULT_BOX));
  return (
    CHART_MARK +
    parts.join('；') +
    '：这里保持完全空白、平整干净，不要画任何图表、坐标轴、刻度、网格、柱子、折线、饼图、图例、数字或文字，' +
    '图表之后由程序按数据画进去。画面其他地方也不要出现图表、坐标轴和数字。'
  );
}

function ensureChartClause(action, image) {
  if (!hasCharts(image)) return action;
  const prompt = String(action.prompt || '').trim();
  if (prompt.includes(CHART_MARK)) return action;
  return { ...action, prompt: prompt + (prompt && !/[。.!！?？]$/.test(prompt) ? '。' : '') + chartClause(imageCharts(image)) };
}

function withChartRetry(prompt, reason) {
  const base = String(prompt || '').trim();
  if (base.includes(CHART_RETRY_MARK)) return base;
  return (
    base +
    CHART_RETRY_MARK +
    (reason ? '：' + reason : '') +
    '。这一轮必须把这块区域留成一整块空白、平整的面板，上面不要画任何图形、线条、数字或花纹。）'
  );
}

// 图表的三项检查挂在 hard 上限裁剪之后（和 H-qr 一样），否则会被降级成 soft。
function chartChecklist(checklist, charts) {
  const rest = (checklist || []).filter((item) => !CHART_CHECK_IDS.has(item.id));
  return charts && charts.length ? rest.concat({ ...CHART_HARD_CHECK }, { ...NO_CHART_CHECK }, { ...CHART_FIT_CHECK }) : rest;
}

function chartFailText(summary) {
  const failed = ((summary && summary.items) || []).filter((item) => !item.ok);
  if (!failed.length) return '未知原因';
  return dedupe(failed.map((item) => item.reasonText + (item.detail ? '（' + item.detail + '）' : ''))).join('；');
}

function chartVerifyText(summary) {
  return ((summary && summary.items) || [])
    .map((item) => (CHART_TYPES[item.type] || '图表') + (item.verify ? '：' + item.verify.note : ''))
    .join('；');
}

// 交付时每张图的图表状况：给页面显示，也决定要不要请用户核对数据。
function chartDelivery(image, chosen) {
  const charts = imageCharts(image);
  if (!charts.length) return null;
  const summary = chosen && chosen.program && chosen.program.chart;
  const items = charts.map((chart, index) => {
    const drawn = summary && (summary.items || [])[index];
    return {
      type: chart.type,
      typeLabel: CHART_TYPES[chart.type] || chart.type,
      title: chart.title || '',
      ok: Boolean(drawn && drawn.ok),
      note: !drawn ? '这一版没有画图表' : drawn.ok ? (drawn.verify ? drawn.verify.note : '') : drawn.reasonText + (drawn.detail ? '（' + drawn.detail + '）' : ''),
      verify: drawn && drawn.verify ? { ok: Boolean(drawn.verify.ok), maxErrorPx: drawn.verify.maxErrorPx, checked: drawn.verify.checked } : null,
      unit: chart.unit || '',
      categories: chart.categories,
      series: chart.series.map((one) => ({ name: one.name, values: one.values })),
      unverified: chart.check && !chart.check.ok ? chart.check.missing : [],
      labelsDropped: Boolean(drawn && drawn.labelsDropped),
      warning: (drawn && drawn.warning) || '',
    };
  });
  const status = summary ? summary.status : 'missing';
  return {
    status,
    note:
      status === 'overlay'
        ? '图表由程序按数据画入，从最终文件量回来核对通过'
        : status === 'missing'
          ? '这一版没有画图表'
          : '图表没画上：' + chartFailText(summary),
    items,
  };
}

// 交付里要请用户处理的图表问题，只挂在这一版交付上。
function chartQuestions(image, info) {
  if (!info) return [];
  const out = [];
  if (info.status === 'failed') out.push(image.id + ' 的图表没能由程序画进去（' + info.note.replace(/^图表没画上：/, '') + '）。可以回复「重画」重新生成这张图');
  info.items.forEach((item, index) => {
    const name = '图表 ' + (index + 1) + (item.title ? '「' + item.title + '」' : '');
    if (item.unverified.length) {
      out.push(image.id + ' 的' + name + '里有 ' + item.unverified.length + ' 个数在你的原话里找不到（' + item.unverified.join('、') + '），是按规划写的数画的，请核对；要改就直接说「把……改成……」');
    }
    if (item.labelsDropped) out.push(image.id + ' 的' + name + '数值太密，没有逐个标注，数值可以对照坐标轴读');
    if (item.warning) out.push(image.id + ' 的' + name + '：' + item.warning);
  });
  return out;
}

// 只改图表时沿用上一版的评审结论，同时按这一版的程序结果改写程序验的项。
function carryProgramVerdict(verdict, image, candidate) {
  if (!verdict) return null;
  const copy = JSON.parse(JSON.stringify(verdict));
  copy.checks = copy.checks || {};
  const checklist = image.spec.checklist || [];
  const typed = candidate.program && candidate.program.text;
  const charted = candidate.program && candidate.program.chart;
  for (const item of checklist) {
    if ((/^T\d+$/.test(item.id) || item.id === TEXT_HARD_CHECK.id) && typed && typed.status === 'overlay') {
      copy.checks[item.id] = { result: 'pass', note: '文字由程序按原文重新排入' };
    }
    if (item.id === CHART_HARD_CHECK.id && charted) {
      copy.checks[item.id] = charted.status === 'overlay' ? { result: 'pass', note: '图表由程序按数据重新画入并核对' } : { result: 'fail', note: chartFailText(charted) };
    }
  }
  const extra = copy.extraFails || [];
  const hardIds = checklist.filter((item) => item.kind === 'hard').map((item) => item.id);
  const isPass = (id) => copy.checks[id] && (copy.checks[id].result === 'pass' || copy.checks[id].result === 'uncertain');
  copy.hardPassed = hardIds.filter(isPass).length;
  copy.hardTotal = hardIds.length + extra.length;
  copy.hardFailed = hardIds.filter((id) => !isPass(id)).concat(extra);
  return copy;
}

function asText(value) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.filter(Boolean).map((item) => String(item).trim()).filter(Boolean).join('、');
  return String(value).trim();
}

function normalizeSlots(raw, textLayers) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const slots = {};
  for (const spec of SLOT_SPEC) slots[spec.key] = asText(source[spec.key]);
  // 图内文字以 text_layers 为准，planner 漏填时用 text_layers 兜底。
  const fromLayers = (Array.isArray(textLayers) ? textLayers : [])
    .map((layer) => (typeof layer === 'string' ? layer : layer && layer.text))
    .filter(Boolean);
  slots.text = asText(source.text) || asText(fromLayers);
  slots.negative = asText(source.negative);
  return slots;
}

// 把槽位拼成一句完整的中文长 prompt。返回缺失的必填槽位，供上层告警。
// 完全没有 slots 的老格式（planner 直接给 prompt）原样沿用，不塞兜底槽位。
// 画面里要放二维码时（不管有没有内容）都追加 QR_CLAUSE：码画得越规整，程序越容易找到它、换成真码；
// 没给内容的装饰码也一样，用户之后补一句内容就能直接在原图上换。
function composePrompt(slots, freeText, instruction, hasSlots, qrCodes) {
  const qrClause = (qrCodes || []).length ? QR_CLAUSE : '';
  const warm = warmPalette([instruction, slots && slots.style, slots && slots.scene].filter(Boolean).join(' '));
  const colorClause = warm ? COLOR_CLAUSE_WARM : COLOR_CLAUSE;
  if (!hasSlots) {
    const legacy = String(freeText || instruction || '').trim();
    return { prompt: (legacy ? legacy + '。' : '') + qrClause + colorClause, missing: [], slots: null };
  }
  const missing = [];
  const filled = { ...slots };
  for (const spec of SLOT_SPEC) {
    if (filled[spec.key]) continue;
    if (!spec.required) continue;
    missing.push(spec.label);
    filled[spec.key] = spec.key === 'subject' ? String(instruction || '').trim() : spec.fallback;
  }

  if (warm && filled.style) filled.style = stripWarmStyle(filled.style);
  const parts = [];
  const head = [filled.style, filled.shot].filter(Boolean).join('，');
  if (head) parts.push(head + '。');
  for (const spec of SLOT_SPEC) {
    if (spec.key === 'style' || spec.key === 'shot') continue;
    if (!filled[spec.key]) continue;
    parts.push(spec.label + '：' + filled[spec.key] + '。');
  }
  if (filled.text) parts.push('图内文字：' + filled.text + '，字形正确、清晰可读。');
  const negative = warm ? stripWarmNegative(filled.negative) : filled.negative;
  if (negative) parts.push('不要出现：' + negative + '。');
  if (qrClause) parts.push(qrClause);
  parts.push(colorClause);

  const extra = String(freeText || '').trim();
  // planner 同时给了 slots 和自由 prompt 时，自由部分只作为补充追加，避免和槽位重复。
  if (extra && !parts.join('').includes(extra)) parts.push(extra);

  return { prompt: parts.join(''), missing, slots: filled };
}

// ---------------------------------------------------------------- 入口

// 用户点了「停止」。每个阶段之间都要看一眼：以前停止只中断了 Agent 回合，工作流还会按默认方案
// 往下走，接着检索、出角色图、生图，照样花生图请求，最后还会被 deliver 改回「已交付」。
function isCancelled(session) {
  return session.status === 'cancelled';
}

export async function runSession(session, deps) {
  await planNode(session, deps);
  if (isCancelled(session)) return;
  await confirmBlockers(session, deps);
  if (isCancelled(session)) return;
  await materializeRefs(session, deps);
  if (isCancelled(session)) return;
  // 角色基准图必须赶在故事图之前：它就是后面每张图的外观基准。
  await buildCharacterRefs(session, deps);
  if (isCancelled(session)) return;
  // 拿用户给的图直接做动图的，不用先画这张图；其余照常出图，动图的参考图也在其中。
  // 规划点名的 R 编号会话里没有的，退回先画一张参考图。
  for (const image of session.images) {
    if (isAnimation(image) && image.spec.animation.reference !== 'self' && !usesGivenReference(session, image)) {
      image.spec.animation.reference = 'self';
    }
  }
  const direct = session.images.filter((image) => !image.blocked && isAnimation(image) && usesGivenReference(session, image));
  const queue = session.images.filter((image) => !image.blocked && !direct.includes(image));
  const limit = Math.max(1, Math.min(DEFAULTS.imageConcurrency, deps.concurrency || DEFAULTS.imageConcurrency));
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (cursor < queue.length && !isCancelled(session)) {
      const image = queue[cursor];
      cursor += 1;
      try {
        await runImage(session, image, deps);
      } catch (error) {
        // 停止带出来的中断不算异常，也不该再为它起一个选优回合。
        if (isCancelled(session)) return;
        // 走到这里说明 runImage 自己没兜住。仍然把已有候选交给选优，
        // 而不是直接判死——手上明明有图却交付 0 张，是最糟的失败方式。
        const message = describeError(error);
        deps.emit(session, 'paint', image.id + ' 流程异常：' + message, { level: 'error' });
        try {
          await selectBestEffort(session, image, deps);
        } catch {
          image.status = 'failed';
        }
      }
    }
  });
  await Promise.all(workers);
  if (isCancelled(session)) return;
  for (const image of session.images) {
    if (image.blocked || !isAnimation(image)) continue;
    if (direct.includes(image)) {
      await runAnimation(session, image, deps);
      if (isCancelled(session)) return;
      continue;
    }
    // 先画出来的参考图：交付给用户确认，帧等确认之后再出。
    if (image.chosen) {
      ensureAnimationState(image).state = 'awaiting_confirm';
      deps.emit(session, 'plan', image.id + ' 的 GIF 参考图画好了，交给你确认之后再出 ' + image.spec.animation.frames.length + ' 帧');
    }
  }
  // 要拼成 GIF 的组图：评审通过之后补过渡格（拼 GIF 在交付时做）。
  for (const image of session.images) {
    if (image.blocked || isAnimation(image) || !image.chosen || !image.spec.panelGif) continue;
    await ensurePanelTweens(session, image, deps, tweenHooks());
    if (isCancelled(session)) return;
  }
  // 所有图都出完了才比得了：逐图评审看不到别的图，跨图漂移只能在这里抓。
  await crossImageReview(session, deps);
  if (isCancelled(session)) return;
  await deliver(session, deps);
}

// GIF 的帧：出帧、评审、重画都在 animation.mjs 里，这里把工作流的生图、错误分类和交付工具交给它。
function animationHooks() {
  return { executeAction, describeError, isFatal, isContentPolicy, isCancelled, lastDelivered, queuePixelWork };
}

async function runAnimation(session, image, deps) {
  try {
    await runFrames(session, image, deps, animationHooks());
  } catch (error) {
    if (isCancelled(session)) return;
    const message = describeError(error);
    const anim = ensureAnimationState(image);
    anim.state = 'failed';
    anim.error = message;
    if (!image.chosen) image.status = 'failed';
    if (isFatal(error)) session.fatal = message;
    deps.emit(session, 'paint', image.id + ' 的 GIF 没做成：' + message, { level: 'error' });
  }
}

// 动图的追问。返回 true 表示已经处理完并交付；false 表示这次改的是参考图本身，交给下面的普通编辑。
// - 确认参考图（start）：开始出帧。
// - 调节奏、尺寸、循环，删帧、调顺序：不调生图，重新合成；重画、加帧：只画这几帧。
// - 改主体或画面本身（换颜色、换衣服）：照常改参考图，出过的帧作废，改完重新等用户确认。
async function editAnimation(session, image, target, deps) {
  const ops = target.animation;
  const anim = ensureAnimationState(image);
  const waiting = anim.state === 'awaiting_confirm' || !anim.state;
  if (ops && ops.start && (waiting || anim.state === 'failed')) {
    await runAnimation(session, image, deps);
    if (!isCancelled(session)) await deliver(session, deps);
    return true;
  }
  const adjusts = hasAnimationAdjustments(ops);
  // 编辑节点写了这种 GIF 用不上的调整（来回播、弹一下、第一格停多久是组图拼 GIF 的），又没给 prompt：
  // 当成没有可做的改动。落到下面会被当成改参考图，照原 prompt 重画一张，出过的帧全部作废。
  const inert = Boolean(ops && !ops.start && !adjusts && !target.promptGiven);
  if ((adjusts || inert) && !target.promptGiven) {
    const { changes, regenerate } = applyAnimationOps(image, ops);
    if (waiting) {
      deps.emit(session, 'edit', image.id + ' 记下 GIF 的调整：' + (changes.join('，') || '没有可做的改动') + '。确认参考图之后按新的安排出帧');
    } else {
      deps.emit(session, 'edit', image.id + ' 调整 GIF：' + (changes.join('，') || '没有可做的改动') + (regenerate ? '' : '，不重新生图'));
      if (regenerate || anim.state === 'failed') await runAnimation(session, image, deps);
      if (isCancelled(session)) return true;
    }
    await deliver(session, deps);
    return true;
  }
  if (!waiting) resetForNewReference(image);
  else {
    anim.state = 'awaiting_confirm';
    image.spec.animation.reference = 'self';
  }
  return false;
}

// 程序转圈 GIF 的追问（见 motiongif.mjs）。返回 true 表示已经处理完并交付。
// - 要让这张图转起来（animation.motion）：程序转出各帧，不重新生图；
// - 已经转过，只调快慢、方向、格数：重新转；
// - 要改画面本身（写了 prompt）：交给下面的普通编辑，顺带说的转法先记下，交付时按新图重新转。
async function editMotionGif(session, image, target, deps) {
  const ops = target.animation;
  const had = Boolean(image.spec.motionGif);
  const wants = Boolean(ops && ops.motion && (!had || ops.motion.type));
  if (!had && !wants) return false;
  if (target.promptGiven) {
    if (ops) image.spec.motionGif = mergeMotionOps(image.spec.motionGif, ops).spec;
    return false;
  }
  if (!ops) return false;
  const { spec, changes } = mergeMotionOps(image.spec.motionGif, ops);
  if (!spec) return false;
  image.spec.motionGif = spec;
  // 一张图只做一种 GIF：转起来就不再按组图切。
  image.spec.panelGif = null;
  if (wants && image.motionGif && image.motionGif.state === 'failed') image.motionGif = null;
  deps.emit(
    session,
    'edit',
    !had
      ? image.id + ' 由程序绕圆心转出 GIF，不重新生图'
      : changes.length
        ? image.id + ' 调整程序转的 GIF：' + changes.join('，') + '，不重新生图'
        : image.id + ' 程序转的 GIF 没有可做的改动',
  );
  const state = await composeMotionGif(session, image, deps, panelHooks());
  if (isCancelled(session)) return true;
  if (!had && (!state || state.state !== 'done')) {
    image.spec.motionGif = null;
    image.motionGif = null;
    image.panelGifNotice = image.id + ' 没转成 GIF（' + ((state && state.error) || '没有可以转的图') + '），图保持原样';
  }
  await deliver(session, deps);
  return true;
}

// 组图拼 GIF 的追问（见 panelgif.mjs）。返回 true 表示已经处理完并交付。
// - 要把组图做成 GIF（from_panels，或者编辑节点按 GIF 参考图的写法写了 start）：切格拼 GIF，组图不重画，
//   相邻两格之间补过渡格（一次生图、从候选里挑，见 paneltween.mjs）；
// - 已经拼过，只调快慢、顺序、去掉某一格：重新拼；
// - 要改组图本身（写了 prompt）：交给下面的普通编辑，顺带说的节奏先记下，交付时按新的组图重新拼。
async function editPanelGif(session, image, target, instruction, deps) {
  const ops = target.animation;
  const had = Boolean(image.spec.panelGif);
  const wants = Boolean(ops && (ops.fromPanels || ops.start));
  if (!had && !wants) return false;
  // 切换时弹一下只在用户这次的话里点名才加。编辑节点会把清单里「切换时轻微弹一下」照抄成 bounce:true：
  // 真机 20261119-250f55 第 3 轮说「重新变成gif」，又拼出了每次切换都跳一下的那一版。
  if (ops && ops.bounce === true && !bounceAsked(instruction)) {
    ops.bounce = undefined;
    deps.emit(session, 'edit', image.id + ' 编辑节点写了「切换时弹一下」，你这次的话里没提，没有加');
  }
  if (target.promptGiven) {
    if (ops) image.spec.panelGif = mergePanelOps(image.spec.panelGif, ops, image.panelGif).spec;
    return false;
  }
  // 写了 animation、没写 prompt：编辑节点要调的是 GIF 本身，就算一项都没改成（只写了上面去掉的弹一下）也在这里交付，
  // 不能落到下面的普通编辑：那里会拿用户的原话当 prompt 重画组图。
  if (!ops) return false;
  const { spec, changes } = mergePanelOps(image.spec.panelGif, ops, image.panelGif);
  image.spec.panelGif = spec;
  // 用户又说了一次「做成 GIF」：上次没拼成的结果不当缓存，重新拼。
  if (wants && image.panelGif && image.panelGif.state === 'failed') image.panelGif = null;
  // 相邻两格之间补过渡格：在做 GIF（第一次、或者又说了一遍「变成 GIF」）时补；只调节奏时只补调整后多出来的步子；
  // 用户说「更顺一点」就把之前没补成的再试一次。切不出格子的这里什么都不做。
  const tweenMode = ops.smooth === true ? 'retry' : !had || wants ? 'make' : 'adjust';
  await ensurePanelTweens(session, image, deps, tweenHooks(), { mode: tweenMode });
  if (isCancelled(session)) return true;
  if (ops.redo.length || ops.add.length) {
    deps.emit(session, 'edit', image.id + ' 是组图拼成的 GIF，没法单独重画或加一格：要改哪一格，直接说改成什么样，改完组图会重新拼', { level: 'warn' });
  }
  // 组图本身不重画；补过渡格要生图的话，上面已经单独说了。
  deps.emit(
    session,
    'edit',
    !had
      ? image.id + ' 把组图切格拼成 GIF，组图不重画' + (changes.length ? '（' + changes.join('，') + '）' : '')
      : changes.length
        ? image.id + ' 调整组图拼的 GIF：' + changes.join('，') + '，组图不重画'
        : image.id + (wants ? ' 重新拼组图的 GIF，设定不变' : ' 组图拼的 GIF 没有可做的改动'),
  );
  const state = await composePanelGif(session, image, deps, panelHooks());
  if (isCancelled(session)) return true;
  if (!had && (!state || state.state !== 'done')) {
    // 拼不成就不留这个设定：之后每次交付都会再切一遍，还会一直挂着「没拼成」。
    image.spec.panelGif = null;
    image.panelGif = null;
    image.panelTweens = null;
    // 这个会话是几张单独的图（四张一组的漫画）：面板只拼一张分格组图，几张图按顺序拼要用聊天里的 h3-gif。
    const several = session.images.filter((item) => item.chosen).length >= 2;
    image.panelGifNotice =
      image.id + ' ' + ((state && state.error) || '没有可以拼的图') + '，这次没有做 GIF，图保持原样' +
      (state && state.notGrid
        ? several
          ? '。这几张单独的图要按顺序拼成 GIF，可以在聊天里说「把这几张图拼成 GIF」，由 Agent 用随包的 h3-gif 工具拼'
          : '。要让一张单独的图动起来，可以新开一次任务：上传这张图，说要它做什么动作'
        : '');
  }
  await deliver(session, deps);
  return true;
}

function panelHooks() {
  return { queuePixelWork, lastDelivered, describeError };
}

// 过渡格要调生图：比拼 GIF 多了生图和错误分类。
function tweenHooks() {
  return { executeAction, describeError, isFatal, isContentPolicy, isCancelled, lastDelivered, queuePixelWork };
}

// 组图 GIF 有几步没补上过渡格：卡片上说一句为什么（不放进交付说明：GIF 照样能用，只是那几步直接切换）。
function tweenNoteFor(image, panelState) {
  const spec = image.spec.panelGif;
  if (!spec || spec.smooth === false) return '';
  const state = image.panelTweens;
  if (!state || state.sourceId !== panelState.sourceId) return '';
  const failed = state.pairs.filter((pair) => pair.status === 'failed');
  if (state.note && !state.pairs.length) return state.note;
  if (!failed.length) return '';
  return '第 ' + failed.map((pair) => pair.from + '→' + pair.to).join('、') + ' 步没补上过渡格（' + failed[0].problem + '），这几步直接切换';
}

function withoutUnaskedBounce(spec, words) {
  if (spec && spec.bounce && !bounceAsked(words)) spec.bounce = false;
  return spec;
}

// 关键待确认必须在出图之前问。事后在交付里堆一串"需要你确认"没有意义：
// 图已经生成完了，用户看到也只能重跑一遍。
const MAX_BLOCKERS = 2;

async function confirmBlockers(session, deps) {
  const ask = (session.blockers || []).slice(0, MAX_BLOCKERS);
  if (!ask.length) return;
  if (typeof deps.askUser !== 'function') {
    session.questions.push(...ask.map((item) => item.text));
    return;
  }
  deps.emit(session, 'question', '出图前需要你定 ' + ask.length + ' 件事', {
    level: 'warn',
    detail: detail('出图前确认', [
      list(
        '问题',
        ask.map((item) => ({ tag: 'warn', text: item.text, note: (item.options || []).join(' / ') })),
      ),
    ]),
  });
  const answers = await deps.askUser(session, ask);
  session.blockers = [];
  if (!answers.length) {
    deps.emit(session, 'question', '没等到回答，按规划时选的默认方案继续出图');
    session.assumptions.push(
      ...ask.map((item) => item.text + '：未回答，按默认「' + (item.default || '自行判断') + '」执行'),
    );
    return;
  }
  session.answered.push(...answers);
  deps.emit(session, 'question', '已确认，按你的回答重新规划');
  await planNode(session, deps);
}

function normalizeBlockers(raw) {
  const rows = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const item of rows) {
    if (typeof item === 'string') {
      if (item.trim()) out.push({ text: item.trim(), options: [], default: '' });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const question = String(item.text || item.question || '').trim();
    if (!question) continue;
    const options = (Array.isArray(item.options) ? item.options : [])
      .map((one) => String(one || '').trim())
      .filter(Boolean)
      .slice(0, 4);
    out.push({ text: question, options, default: String(item.default || options[0] || '').trim() });
  }
  return out.slice(0, MAX_BLOCKERS);
}

// 检索节点：planner 只产出「要搜什么」（ref_queries），真正的搜图由运行时调 Connector 工具。
// 失败不阻断主流程——降级成无参考图文生图，并把原因写进交付的待确认项。
// options.ask === false：失败时不往交付里加提问，由调用方自己写（追问里重新找图时按检索项逐条说）。
// ---------------------------------------------------------------- 检索预算
//
// 要不要检索、搜几项、肯花多大力气，由规划决定（ref_budget），运行时只负责按预算执行。
// 计数的是两样真正花时间的调用：搜图工具（第一次检索每项各算一次，换说法重搜每次一次）和候选判定
// （每批一次，一次判定是一个模型回合）。下载不单独计：每批判定之前才下那 3 张。
// 每搜一项都给它预留一次判定，别的项换说法重搜、多判几批都不能占这一次（见 spendRef）；
// 判定其实没调用模型的那一批不算（见 refundRef）。预算花完就停，没搜的、没判完的项照实写进交付说明。
function normalizeRefBudget(raw, count) {
  if (!(count > 0)) return 0;
  const value = Number(raw);
  if (raw === undefined || raw === null || raw === '' || !Number.isFinite(value)) {
    return Math.min(DEFAULTS.refBudgetMax, Math.max(DEFAULTS.refBudgetDefault, count * 2));
  }
  return Math.max(0, Math.min(DEFAULTS.refBudgetMax, Math.round(value)));
}

// reserved：已经搜了、还没判过的项，每项预留的那一次判定。
function makeRefBudget(limit) {
  return { limit, used: 0, searches: 0, gates: 0, reserved: 0, stopped: [] };
}

// 先付后做：付不起就返回 false，调用方跳过这一步。
// 别的项预留的判定不能占：判定阶段同时判两项，以前谁先用谁先得，前一项第一批被全否、换说法重搜，
// 会把后一项预留的那次判定用掉，后一项搜了却一次都没判（预算 6、3 项时实测）。
// 所以换说法重搜、第 2 批以后的判定，只能用预留之外的预算；某一项自己的第一次判定用它自己那一份。
function spendRef(budget, kind, entity) {
  if (!budget) return true;
  const own = kind === 'gate' && Boolean(entity && entity.reserved);
  const others = budget.reserved - (own ? 1 : 0);
  if (budget.used + 1 + others > budget.limit) return false;
  budget.used += 1;
  if (kind === 'search') budget.searches += 1;
  else budget.gates += 1;
  if (own) {
    entity.reserved = false;
    budget.reserved -= 1;
  }
  return true;
}

// 扣了次数、这一步其实没调用模型（候选一张都没下载下来、只有一张可用直接选用）：次数还回去，
// 用的是这一项自己预留的那一份的话，预留也还回去。
function refundRef(budget, kind, entity, own) {
  if (!budget) return;
  budget.used -= 1;
  if (kind === 'search') budget.searches -= 1;
  else budget.gates -= 1;
  if (own && entity) {
    entity.reserved = true;
    budget.reserved += 1;
  }
}

function refBudgetLine(budget) {
  if (!budget) return '';
  return '检索预算 ' + budget.limit + ' 次，用了 ' + budget.used + ' 次（搜图 ' + budget.searches + '、判定 ' + budget.gates + '）';
}

// 一张候选都没拿到的项（搜图服务报错、或者一张都没回）用 alt_query 再搜一次。预算里给它留出判定的那一次：
// 第一次检索时每项都预留过一次判定，这一项还没用过，所以只要再付得起这一次搜图就行。
async function retryWithAltQueries(session, queries, result, deps, budget) {
  const hits = result.ok
    ? result.hits.slice()
    : queries.map((item) => ({ task_name: item.task_name, query: item.query, url: '', title: '', source: '', candidates: [] }));
  let changed = false;
  for (const item of queries) {
    const index = hits.findIndex((hit) => hit.task_name === item.task_name);
    const hit = index >= 0 ? hits[index] : null;
    if (hit && hit.candidates && hit.candidates.length) continue;
    if (!item.alt_query) continue;
    if (!spendRef(budget, 'search')) {
      deps.emit(session, 'think', '「' + item.query + '」没搜到，检索预算不够再换说法搜一次', { level: 'warn' });
      continue;
    }
    // 失败原因里带错误码的（「task：（CONNECTOR_PROVIDER_ERROR）…」）是服务报错，其余是一张都没回。
    const errored = String(result.reason || '').includes(item.task_name + '：（');
    deps.emit(session, 'think', '「' + item.query + '」' + (errored ? '搜图服务报错' : '一张都没搜到') + '，换规划给的另一种说法再搜一次：' + item.alt_query, { level: 'warn' });
    const again = await searchRefImages(deps.context, [{ ...item, query: item.alt_query }]);
    if (again.stop) break;
    const got = again.ok && again.hits[0] && again.hits[0].candidates.length ? again.hits[0] : null;
    if (!got) continue;
    const next = { ...got, task_name: item.task_name, tried: [item.query] };
    if (index >= 0) hits[index] = next;
    else hits.push(next);
    changed = true;
  }
  if (!changed) return result;
  const missing = queries.filter((item) => !hits.some((hit) => hit.task_name === item.task_name && hit.url));
  return {
    ...result,
    ok: true,
    hits,
    reason: missing.length ? '部分实体没搜到：' + missing.map((item) => item.task_name).join('、') : '',
  };
}

async function runRefSearch(session, queries, deps, options) {
  const ask = !options || options.ask !== false;
  const budget = (options && options.budget) || null;
  // 第一次检索每项各算一次搜图，并给它留出一次判定：只搜不判等于白搜（预算 2、3 项时，
  // 先把 2 次都花在搜前两项上，结果一项都判不了）。付不起「搜 1 + 判 1」的项不搜，
  // 排在后面的先让出预算：规划把最要紧的写在前面。
  if (budget) {
    const affordable = [];
    budget.stoppedTasks = budget.stoppedTasks || [];
    for (const item of queries) {
      // 这一项要搜 1 次，还要给它留 1 次判定；已经搜了的项各自留的那一次也不能动。
      if (budget.used + 1 + budget.reserved + 1 <= budget.limit && spendRef(budget, 'search')) {
        budget.reserved += 1;
        affordable.push(item);
      } else {
        budget.stopped.push(item.query);
        budget.stoppedTasks.push(canonicalRef(item.task_name));
      }
    }
    if (affordable.length < queries.length) {
      deps.emit(session, 'think', '检索预算 ' + budget.limit + ' 次不够搜全部 ' + queries.length + ' 项，后面 ' + (queries.length - affordable.length) + ' 项不搜：' + queries.slice(affordable.length).map((item) => item.query).join('、'), { level: 'warn' });
    }
    queries = affordable;
    if (!queries.length) return [];
  }
  const startedAt = Date.now();
  const useOf = (item) => (REF_USE_LABELS[item.use] || REF_USE_LABELS.subject).replace(/参考$/, '');
  deps.emit(session, 'think', '检索参考图：' + queries.map((item) => item.query + '（' + useOf(item) + '）').join('、'), {
    detail: detail('检索节点 · 输入', [
      text(
        '检索意图',
        queries.map((item) => item.task_name + '：' + item.query + ' · ' + useOf(item) + (item.take ? '，' + item.take : '')).join('\n'),
      ),
      list(
        '相关性要求',
        queries.map((item) => ({ text: item.task_name + '：' + (item.prompt || '（无）') })),
      ),
    ]),
  });

  let result = await searchRefImages(deps.context, queries);
  // 有的说法搜图服务直接报错或一张都不回（真机 20261117-21581a：「尼克·杨 问号脸 表情包 原图」报 CONNECTOR_PROVIDER_ERROR，
  // 重试一次还是报错），以前就此放弃：换说法重搜只在「搜到了、判定全否」时才走，规划写好的另一种说法一次都没用上。
  // 现在一张候选都没拿到的项，用规划给的另一种说法（alt_query）再搜一次。工具没有、被拒（stop）的不再试：换说法也一样。
  if (!result.stop) result = await retryWithAltQueries(session, queries, result, deps, budget);
  if (!result.ok) {
    deps.emit(session, 'think', '参考图检索未成功：' + result.reason, {
      level: 'warn',
      durMs: Date.now() - startedAt,
      detail: detail('检索结果', [
        kv('状态', '未取得参考图'),
        text('原因', result.reason),
        text('影响', '本轮按无参考图走文生图；需要真人 / 车型一致性时请手动上传参考图。'),
      ]),
    });
    if (ask) session.questions.push('参考图检索未成功（' + result.reason + '），如果一致性要求高请手动上传参考图。');
    return [];
  }

  const hits = result.hits.filter((item) => item.url);
  // 有图但有实体没搜到时也要说一句，否则用户会以为某个人/车没要求参考图。
  if (result.reason) {
    deps.emit(session, 'think', '部分参考图没检索到：' + result.reason, { level: 'warn' });
  }
  deps.emit(session, 'think', '检索到 ' + hits.length + ' 张参考图：' + hits.map((item) => item.task_name).join('、'), {
    durMs: Date.now() - startedAt,
    detail: detail('检索结果', [
      kv('工具', result.tool || 'search_images'),
      kv(
        '候选池',
        result.hits.reduce((sum, item) => sum + (item.candidates || []).length, 0) +
          ' 张，每次取 ' + DEFAULTS.refBatch + ' 张下载判定',
      ),
      list(
        '逐条',
        result.hits.map((item) => ({
          tag: item.url ? 'pass' : 'fail',
          text:
            item.task_name +
            '：' +
            ((item.candidates || []).length ? '返回 ' + item.candidates.length + ' 张候选' : '没有返回图片'),
          note: item.url ? item.title || '' : '',
        })),
      ),
      list(
        '候选来源',
        result.hits.flatMap((item) =>
          (item.candidates || []).slice(0, DEFAULTS.refBatch).map((candidate, index) => ({
            text: item.task_name + ' #' + (index + 1) + '：' + (candidate.title || '（无标题）'),
            note: candidate.source || candidate.url,
          })),
        ),
      ),
    ]),
  });
  return hits;
}

// 标识符归一：大小写、下划线、连字符、空格、中文一律抹平后再比。
// 规划在 ref_queries 和 refs 两处写的名字经常不完全一致（"lixiang mega_home" / "lixiangmega_home"），
// 严格相等会让参考图白白丢掉。
function canonicalRef(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// refs 允许三种写法：R 编号、ref_queries 的 task_name、公网地址，统一归一成 R 编号。
// 一张都没拿到时也要跑：否则规划写的 task_name 原样留着、entry 还是 edit，
// 执行端会直接抛「edit 缺少可用参考图」，整张图白跑。
function settleImageRefs(session, deps, plannedRefs, byUrl, byTask, knownTasks) {
  const byTaskLoose = new Map();
  for (const [name, id] of byTask) {
    const key = canonicalRef(name);
    if (key && !byTaskLoose.has(key)) byTaskLoose.set(key, id);
  }
  const known = knownTasks || new Set();
  for (const image of session.images) {
    const next = [];
    for (const ref of image.spec.refs || []) {
      if (typeof ref !== 'string' || !ref) continue;
      if (/^https?:\/\//i.test(ref)) {
        const id = byUrl.get(ref);
        if (id) next.push(id);
        continue;
      }
      if (/^R\d+$/i.test(ref)) {
        next.push(ref.toUpperCase());
        continue;
      }
      const id = byTask.get(ref) || byTaskLoose.get(canonicalRef(ref));
      if (id) {
        next.push(id);
        continue;
      }
      if (known.has(canonicalRef(ref))) {
        const unsearched = session.refBudget && (session.refBudget.stoppedTasks || []).includes(canonicalRef(ref));
        deps.emit(session, 'think', image.id + ' 想要的参考图「' + ref + '」' + (unsearched ? '超出检索预算，没有检索' : '没搜到可用图片') + '，已忽略', {
          level: 'warn',
        });
        continue;
      }
      // 检索整体失败时不必逐条报「已忽略」，后面那条「已降级成文生图」已经说清了。
      if (byUrl.size || byTask.size) {
        deps.emit(session, 'think', image.id + ' 的参考图标识「' + ref + '」既不是 R 编号也不是检索任务名，已忽略', {
          level: 'warn',
        });
      }
    }
    image.spec.refs = dedupe(next);
    if (image.spec.refs.length) {
      image.spec.entry = 'edit';
    } else if (image.spec.entry === 'edit') {
      // 检索或下载全挂时必须降级成文生图：规划说 entry=edit 但一张参考图都没有，
      // 执行端会直接抛「edit 缺少可用参考图」，整张图就白跑了。
      image.spec.entry = 't2i';
      deps.emit(session, 'think', image.id + ' 没有可用参考图，已降级成文生图', {
        level: 'warn',
        detail: detail('降级为文生图', [
          kv('图', image.id + ' · ' + image.title),
          text('原本要的参考图', (plannedRefs.get(image.id) || []).join('、') || '（无）'),
          text('影响', '一致性只能靠文字描述，成图与真人 / 真车可能有差距。'),
        ]),
      });
    }
  }
}

// ---------------------------------------------------------------- 参考图

// 检索结果收成统一的"实体"结构。
// 检索来的候选和用户给的图片地址走同一条下载 + 判定链路，只是后者不做相关性判定。
// options.directUrls：直接给出的图片地址（默认取各图 spec.refs 里的地址，已经按用户原话过滤过）；
// options.exclude：不再考虑的地址（追问里用户说不对的那张旧参考图）；
// options.keyPrefix：判定拼图的文件名前缀，追问轮用自己的前缀，不覆盖首轮的拼图。
function refEntities(session, hits, queries, options) {
  const opts = options || {};
  const exclude = opts.exclude || new Set();
  const specOf = new Map();
  for (const item of queries) specOf.set(item.task_name, item);
  const prefix = opts.keyPrefix || 'q';
  const entities = [];
  const byHead = new Map();
  for (const hit of hits) {
    const pool = (hit.candidates || []).filter((item) => item && item.url && !exclude.has(item.url));
    if (!pool.length) continue;
    const head = pool[0].url;
    const existing = byHead.get(head);
    // 两个实体搜到同一批图时合并成一个，登记阶段再把 task_name 记成别名。
    if (existing) {
      if (hit.task_name && existing.taskNames.indexOf(hit.task_name) < 0) existing.taskNames.push(hit.task_name);
      continue;
    }
    const spec = specOf.get(hit.task_name) || {};
    const entity = {
      key: prefix + entities.length,
      taskNames: hit.task_name ? [hit.task_name] : [],
      query: hit.query,
      altQuery: spec.alt_query || '',
      note: hit.query,
      requirement: spec.prompt || '',
      use: spec.use || 'subject',
      take: spec.take || '',
      pool,
      cursor: 0,
      searches: 0,
      // 第一次检索报错、换了说法才搜到的，原来那个说法也算搜过，之后换说法重搜不再用它。
      queried: new Set([hit.query, ...(hit.tried || [])]),
      seen: new Set([...pool.map((item) => item.url), ...exclude]),
      direct: false,
    };
    byHead.set(head, entity);
    entities.push(entity);
  }
  const directUrls = opts.directUrls || directRefUrls(session);
  for (const ref of directUrls) {
    entities.push({
      key: 'u' + entities.length,
      taskNames: [],
      query: ref,
      altQuery: '',
      // 地址可能有好几张，都叫"你给的地址"在时间线上分不清谁是谁，带上文件名。
      note: '你给的 ' + shortUrlLabel(ref),
      requirement: '',
      pool: [{ url: ref, title: '', source: ref }],
      cursor: 0,
      searches: 0,
      queried: new Set(),
      seen: new Set([ref]),
      direct: true,
    });
  }
  return entities.slice(0, DEFAULTS.refDownloadLimit);
}

function directRefUrls(session) {
  const out = [];
  for (const image of session.images) {
    for (const ref of image.spec.refs || []) {
      if (typeof ref === 'string' && /^https?:\/\//i.test(ref) && out.indexOf(ref) < 0) out.push(ref);
    }
  }
  return out;
}

// 图片地址只认用户自己说过的：规划和编辑节点凭记忆写的网址多半是编的（真机 20261112-8a442a：
// 编辑节点写了一个 Wikimedia 地址，缩略图、原图、文件页全是 404，生图请求因此连败 6 轮），
// 就算碰巧能打开，直接给的地址不经过相关性判定，也可能是一张错的图。要找图就走检索。
// 返回过滤后的 refs，丢掉的地址在时间线上说一句。
function keepUserUrls(session, image, refs, deps, extraSources) {
  const sources = qrSources(session, extraSources);
  const out = [];
  for (const ref of refs || []) {
    if (typeof ref !== 'string' || !/^https?:\/\//i.test(ref)) {
      out.push(ref);
      continue;
    }
    if (isVerbatim(ref, sources)) {
      out.push(ref);
      continue;
    }
    deps.emit(session, 'think', image.id + ' 的参考图地址「' + shortUrlLabel(ref) + '」不在你说过的话里，已忽略；要找图请让它重新检索', {
      level: 'warn',
      detail: detail('忽略的参考图地址', [text('地址', ref), text('原因', '不是你给的地址。凭记忆写的网址多半打不开，也没经过相关性判定。')]),
    });
  }
  return out;
}

// 从地址里取一个能认出来的短标签：优先文件名，没有就用主机名。
function shortUrlLabel(url) {
  const text = String(url || '');
  try {
    const parsed = new URL(text);
    const name = parsed.pathname.split('/').filter(Boolean).pop();
    return (name || parsed.hostname).slice(0, 28);
  } catch {
    return text.slice(-28);
  }
}

function cacheOf(deps) {
  if (deps.cache) return deps.cache;
  // 没注入缓存时退回到会话内目录，保证链路本身不依赖调用方。
  if (!deps.localCache) deps.localCache = createRefCache(join(deps.dirs.root, 'cache'));
  return deps.localCache;
}

// 相关性判定：把这一批候选拼成一张带编号的材料图，让 VLM 挑一张。
// 挑不出来比硬塞一张强得多——错的参考图会让成图看着完全正常却根本不像，
// 评审端也发现不了（它只对照参考图，看不出参考图本身是错的）。
//
// 返回 { entry, reason, shown, skipped }：shown 是真正拼进材料图、判定节点看过的候选（usable 下标），
// skipped 是解不开、没送去判定的。时间线要靠它们如实区分「判过不合格」和「根本没看」。
async function gateRefCandidates(session, entity, usable, deps, attempt) {
  if (entity.direct) return { entry: usable[0].entry, reason: '你给的地址，不再判定', shown: [0], skipped: [] };
  await mkdir(deps.dirs.sheets, { recursive: true });
  const sheetPath = join(deps.dirs.sheets, 'cand-' + entity.key + '-' + attempt + '.png');
  let built;
  try {
    built = await review.buildGridSheet(
      usable.map((item) => ({ path: item.entry.path, label: '' })),
      sheetPath,
      { perRow: Math.min(3, usable.length), renumber: true },
    );
  } catch (error) {
    built = { sheet: null, items: [], skipped: usable.map((_, index) => ({ index, error: describeError(error) })) };
  }
  const skipped = (built.skipped || []).map((item) => ({ index: item.index, error: decodeErrorText(item.error) }));
  // 一张都拼不进去就是一张都没法核对：不能再像以前那样「取第一张可用图」，那张图评审端同样看不到。
  if (!built.sheet || !built.items.length) return { entry: null, reason: '候选都解不开', shown: [], skipped };
  // 拼图编号和候选的对应关系，一律以实际画进去的为准。
  const order = built.items.map((item) => item.index);
  if (order.length === 1 && !entity.requirement) {
    return { entry: usable[order[0]].entry, reason: '只有一张可用', shown: order, skipped };
  }

  // 判定只看一张拼图：只给必须的那份，不按难度加（24 个真机会话里 37 次判定全是正好 2 次）。
  const budget = toolBudget('think', { needs: [{ count: 1, what: '打开候选材料图' }], fixed: true });
  const kindOf = entity.use === 'style' || entity.use === 'layout' || entity.use === 'scene';
  const instruction = [
    '你是参考图筛选节点。候选图已经由程序拼成一张材料图，你只要打开它、看、给结论。',
    '',
    '要找的东西：' + entity.note,
    '参考用途：' + (REF_USE_LABELS[entity.use] || REF_USE_LABELS.subject) + (entity.take ? '（' + entity.take + '）' : ''),
    '筛选要求：' + (entity.requirement || '（无额外要求，能清楚看到目标即可）'),
    '',
    '候选材料图：' + sheetPath,
    '  共 ' + order.length + ' 张，每张左上角有数字标签：',
    ...order.map((index, position) => {
      const meta = usable[index].meta || {};
      const source = String(meta.source || '').slice(0, 40);
      const title = String(meta.title || '').slice(0, 70);
      return '  ' + (position + 1) + '：' + [source && '来源 ' + source, title && '标题 ' + title].filter(Boolean).join(' · ');
    }),
    '  来源和标题只能帮你认出图里是什么，以图为准：电商标题经常堆关键词，不能只凭标题判定。',
    '',
    '判定规则（严格照做）：',
    ...(kindOf
      ? [
          '1. 这一项是' + REF_USE_LABELS[entity.use] + '，不要求是某一个具体的东西：只要是「要找的东西」这一类的真实样例，',
          '   而且看得清要参考的地方（画风看笔触和配色，版式看排版和留白，场景看环境），就能选。',
          '   明显是别的类型（要课本内页却是试卷，要丝网印刷海报却是照片）就不能选。',
        ]
      : [
          '1. 先判「是不是这个东西本身」：人物必须是本人、面部清晰可辨识；车型 / 产品 / logo 必须是同一款；建筑、地标必须是同一座；',
          '   动植物品种、食物、服饰、道具必须是同一种。认不出、或者明显是别的东西，就不能选。',
        ]),
    '2. 吉祥物、卡通角色、IP 形象：官方插画、官方立绘、实物雕像、正版手办或玩偶的照片都可以用，',
    '   只要认得出是它本身、外形和配色没有被改掉。同人、Q 版改造、换装、真人 cos 不要选。',
    '3. 筛选要求里写的颜色、五官、肢体数量这类外观描述可能写错了：和你认出的本体对不上时，以本体为准，不要因此否掉。',
    '4. 认出是本体（或这一类的真实样例）之后，再按筛选要求在这些候选里挑最合适的一张。要求里的视角、远近、构图只是偏好：',
    '   没有一张完全满足时，选最能看清它外形的那张，不要因为角度或远近不完美就全否。',
    '5. 这些情况不要选：糊、严重遮挡、纯文字截图、水印或大块文字盖住主体、表情包。角落里的小水印、版权字样不算问题。',
    '6. 拿不准是不是本体（或这一类）就不选。宁可这一批全否，也不要塞一张错的参考图进生成。',
    '7. 不要写脚本、不要裁图量像素、不要联网搜索、不要打开其它文件。只 read 上面这一张材料图。',
    '8. 工具调用上限 ' + budget.limit + ' 次，看完立刻给结论。',
    '',
    '只输出一个 JSON 对象，不要解释、不要 markdown 代码块：',
    '{"pick":1,"reason":"不超过 30 字"}',
    '  pick 填 1..' + order.length + ' 里最合适那张的编号；全都不符合要求就填 0。',
  ].join('\n');

  // asked：这一批真的调用了判定节点（一个模型回合）。前面那几种直接返回的没调用，检索预算不扣这一次（见 refundRef）。
  let data;
  try {
    ({ data } = await deps.agent.runJson(session, { step: 'think', instruction, maxTools: budget.limit, budgetNote: budget.note }));
  } catch {
    return { entry: usable[order[0]].entry, reason: '判定节点异常，取第一张能看的图', shown: order, skipped, asked: true };
  }
  const reason = asText(data.reason).slice(0, 60);
  const pick = Number(data.pick);
  if (!pick || pick < 1 || pick > order.length) return { entry: null, reason: reason || '都不符合要求', shown: order, skipped, asked: true };
  return { entry: usable[order[pick - 1]].entry, reason: reason || '符合要求', shown: order, skipped, asked: true };
}

// 拼图时解不开的原因，翻成时间线上看得懂的话。
function decodeErrorText(message) {
  const value = String(message || '');
  const format = /unsupported_image_format:(\w+)/.exec(value);
  if (format) return '格式不支持（' + format[1] + '）';
  if (/jpeg_cmyk_unsupported/.test(value)) return 'CMYK JPEG 不支持';
  if (/jpeg_unsupported_sof|jpeg_unsupported_precision/.test(value)) return '这种 JPEG 编码不支持';
  return '解码失败：' + value.slice(0, 40);
}

// 一批候选：下载到缓存 -> 机械过滤（缓存模块做）-> 相关性判定。
// 每次只取 refBatch 张：一批 3 张足够挑出一张能用的，全下既慢又把时间线塞满。
// 返回 { picked, judged }：judged 是判定节点真正看过的张数，上层靠它决定要不要换说法重搜。
async function reviewRefBatch(session, entity, batch, deps, attempt) {
  const startedAt = Date.now();
  const cache = cacheOf(deps);
  // 检索来的候选是第三方地址，不许指向本机或内网；用户自己给的地址按接口地址的规则放行。
  const fetched = await Promise.all(batch.map((item) => cache.download(item.url, { publicOnly: !entity.direct })));
  const usable = [];
  fetched.forEach((entry, index) => {
    if (entry.ok) usable.push({ entry, meta: batch[index], fetchedIndex: index });
  });

  const verdict = usable.length ? await gateRefCandidates(session, entity, usable, deps, attempt) : null;
  const pickedPath = verdict && verdict.entry ? verdict.entry.path : '';
  const shown = new Set(verdict ? verdict.shown.map((index) => usable[index].fetchedIndex) : []);
  const skippedWhy = new Map(verdict ? verdict.skipped.map((item) => [usable[item.index].fetchedIndex, item.error]) : []);

  const rows = fetched.map((entry, index) => {
    const meta = batch[index];
    const base = { title: meta.title || '（无标题）', note: meta.source || meta.url };
    if (!entry.ok) return { ...base, key: '', tag: 'warn', text: '下载失败：' + entry.error };
    if (!shown.has(index)) {
      return { ...base, key: 'cache/' + entry.file, tag: 'warn', text: '没送去判定：' + (skippedWhy.get(index) || '解不开') };
    }
    const chosen = entry.path === pickedPath;
    return { ...base, key: 'cache/' + entry.file, tag: chosen ? 'pass' : 'fail', text: chosen ? '已选用' : '不符合要求' };
  });

  const judged = shown.size;
  const unjudged = batch.length - judged;
  const tail = unjudged ? '（另有 ' + unjudged + ' 张下载失败或解不开）' : '';
  let headline;
  if (verdict && verdict.entry) headline = entity.note + '：判定了 ' + judged + ' 张，选定 1 张' + tail;
  else if (judged) headline = entity.note + '：判定了 ' + judged + ' 张，都不符合要求' + tail + '，继续找';
  else headline = entity.note + '：这一批 ' + batch.length + ' 张候选都没能送去判定（下载失败或解不开），继续找';

  deps.emit(session, 'think', headline, {
    level: verdict && verdict.entry ? 'info' : 'warn',
    durMs: Date.now() - startedAt,
    detail: detail('候选判定 · 第 ' + (attempt + 1) + ' 批', [
      kv('要找的', entity.note),
      text('相关性要求', entity.requirement || '（规划没写要求，按能下载、够清晰采用）'),
      thumbs('检索结果（' + batch.length + ' 张）', rows),
      verdict ? text('判定', verdict.reason) : null,
      fetched.some((entry) => entry.cached) ? kv('缓存命中', fetched.filter((entry) => entry.cached).length + ' 张') : null,
    ]),
  });

  const asked = Boolean(verdict && verdict.asked);
  if (!verdict || !verdict.entry) return { picked: null, judged, asked };
  return {
    picked: { path: verdict.entry.path, file: verdict.entry.file, url: verdict.entry.url, reason: verdict.reason },
    judged,
    asked,
  };
}

// 换个说法再搜一轮。两种时机：候选池用完了；或者上一批判定节点看过、全部否掉（不等池子用完）——
// 后者说明这个说法搜回来的图本身就不对，接着往下翻同一批结果多半还是不对。
// 先用规划给的另一种说法（原产地语言或英文的正式名称），再用通用改写。新结果排在还没判过的候选前面。
async function searchMoreCandidates(session, entity, deps, rejected, budget) {
  if (entity.direct || entity.searches >= DEFAULTS.refSearchRounds) return [];
  let query = '';
  if (entity.altQuery && !entity.queried.has(entity.altQuery)) query = entity.altQuery;
  for (let round = 0; !query && round < 3; round += 1) {
    const variant = broadenQuery(entity.query, round);
    if (variant && !entity.queried.has(variant)) query = variant;
  }
  if (!query) return [];
  if (!spendRef(budget, 'search')) {
    entity.outOfBudget = true;
    return [];
  }
  entity.queried.add(query);
  entity.searches += 1;
  deps.emit(session, 'think', entity.note + '：' + (rejected ? '这一批都不对' : '候选用完了') + '，换个说法再搜（' + query + '）', {
    level: 'warn',
  });
  let result;
  try {
    result = await searchRefImages(deps.context, [
      { task_name: entity.taskNames[0] || entity.key, query, prompt: entity.requirement },
    ]);
  } catch {
    return [];
  }
  const hit = result && result.ok ? result.hits[0] : null;
  const fresh = ((hit && hit.candidates) || []).filter((item) => item && item.url && !entity.seen.has(item.url));
  for (const item of fresh) entity.seen.add(item.url);
  entity.pool.splice(entity.cursor, 0, ...fresh);
  return fresh;
}

async function resolveEntityRef(session, entity, deps, budget) {
  let rejected = false;
  for (let attempt = 0; attempt < DEFAULTS.refGateRounds; attempt += 1) {
    if (rejected) await searchMoreCandidates(session, entity, deps, true, budget);
    let batch = entity.pool.slice(entity.cursor, entity.cursor + DEFAULTS.refBatch);
    entity.cursor += batch.length;
    if (!batch.length) {
      const more = await searchMoreCandidates(session, entity, deps, false, budget);
      if (!more.length) return null;
      batch = entity.pool.slice(entity.cursor, entity.cursor + DEFAULTS.refBatch);
      entity.cursor += batch.length;
      if (!batch.length) return null;
    }
    // 用户给的地址不判定（见 gateRefCandidates），不花预算。这一项还没判过时用它自己预留的那一次判定。
    const own = Boolean(entity.reserved);
    if (!entity.direct && !spendRef(budget, 'gate', entity)) {
      entity.outOfBudget = true;
      return null;
    }
    const result = await reviewRefBatch(session, entity, batch, deps, attempt);
    // 候选一张都没下载下来、只有一张直接选用：没有调用判定节点，这一次不算。
    if (!entity.direct && !result.asked) refundRef(budget, 'gate', entity, own);
    if (result.picked) return result.picked;
    // 只有判定节点真看过、而且全否了，才说明是说法的问题；只是下载失败就接着翻同一批结果。
    rejected = result.judged > 0;
  }
  return null;
}

// 并发 2：下载是网络等待、判定是一次模型调用，再高会顶到运行时的 agentConcurrency。
async function resolveEntities(session, entities, deps, budget) {
  const resolved = new Map();
  let cursor = 0;
  // 检索时每搜一项预留了一次判定。真正要判定的是搜回了候选的项（一张都没回的不判，两项搜回同一批图的并成一项），
  // 按它们重新算一遍预留，多出来的还给公共的那部分。
  if (budget) {
    budget.reserved = 0;
    for (const entity of entities) {
      entity.reserved = !entity.direct;
      if (entity.reserved) budget.reserved += 1;
    }
  }
  const release = (entity) => {
    if (!budget || !entity.reserved) return;
    entity.reserved = false;
    budget.reserved -= 1;
  };
  const workers = Array.from({ length: Math.min(2, entities.length) }, async () => {
    while (cursor < entities.length) {
      const entity = entities[cursor];
      cursor += 1;
      try {
        const picked = await resolveEntityRef(session, entity, deps, budget);
        if (picked) resolved.set(entity.key, picked);
        release(entity);
      } catch (error) {
        release(entity);
        deps.emit(session, 'think', entity.note + ' 参考图处理异常：' + String(error && error.message ? error.message : error), {
          level: 'warn',
        });
      }
    }
  });
  await Promise.all(workers);
  return resolved;
}

// 判定通过的图复制进会话，登记成 R 编号。同一份文件只登记一次；追问里重搜又搜到原来那张时沿用原编号。
async function registerPickedRef(session, deps, entity, picked, byPath) {
  let id = byPath.get(picked.path);
  if (id) return id;
  const existing = session.refs.find((ref) => ref.source && ref.source === picked.url);
  if (existing) {
    byPath.set(picked.path, existing.id);
    return existing.id;
  }
  id = 'R' + (session.refs.length + 1);
  const file = id + (picked.file.endsWith('.png') ? '.png' : '.jpg');
  await copyFile(picked.path, join(deps.dirs.refs, file));
  session.refs.push({
    id,
    file,
    path: join(deps.dirs.refs, file),
    note: entity.note,
    source: picked.url,
    // 「你给的」只指从文件选择器上传的图（页面会把它放进你的消息气泡），下载来的一律记成检索所得。
    origin: 'search',
    use: entity.use || 'subject',
    take: entity.take || '',
  });
  byPath.set(picked.path, id);
  return id;
}

// 参考图：检索 -> 分批下载到缓存 -> 判定相关性 -> 合格才复制进会话并登记成 R1、R2…
// 存进会话而不是直接用缓存，是为了让生成端和评审端拿到同一份稳定素材。
async function materializeRefs(session, deps) {
  const queries = normalizeRefQueries(session.plan && session.plan.ref_queries);
  // 规划写进 refs 的地址只认用户原话里出现过的，见 keepUserUrls。
  for (const image of session.images) image.spec.refs = keepUserUrls(session, image, image.spec.refs, deps);
  const budget = makeRefBudget(normalizeRefBudget(session.plan && session.plan.ref_budget, queries.length));
  session.refBudget = budget;
  if (queries.length && !budget.limit) {
    // 规划自己说预算是 0：它写的检索项一律不搜。一般是规划写了项、又判断不值得花时间。
    budget.stopped = queries.map((item) => item.query);
    budget.stoppedTasks = queries.map((item) => canonicalRef(item.task_name));
    deps.emit(session, 'think', '规划写了 ' + queries.length + ' 项检索，但检索预算是 0，这次不检索：' + queries.map((item) => item.query).join('、'), { level: 'warn' });
  }
  const hits = queries.length && budget.limit ? await runRefSearch(session, queries, deps, { budget }) : [];
  const knownTasks = new Set(queries.map((item) => canonicalRef(item.task_name)).filter(Boolean));
  // 降级判定要用规划时写的原始 refs，映射之后就看不出来了。
  const plannedRefs = new Map();
  for (const image of session.images) plannedRefs.set(image.id, (image.spec.refs || []).slice());
  // 预算不够、根本没搜的项不会生成实体，单独列出来。
  const unsearched = budget.stopped.map((query) => ({ tag: 'warn', text: query, note: '超出检索预算，没有检索' }));
  for (const query of budget.stopped) {
    session.questions.push('「' + query + '」超出了这次的检索预算，没有检索参考图，如果一致性要求高请手动上传。');
  }

  const entities = refEntities(session, hits, queries);
  if (!entities.length) {
    settleImageRefs(session, deps, plannedRefs, new Map(), new Map(), knownTasks);
    return;
  }

  const cache = cacheOf(deps);
  // 每轮会话最多清一次缓存，失败不影响主流程。
  if (cache.prune) await cache.prune();

  const resolved = await resolveEntities(session, entities, deps, budget);

  const byUrl = new Map();
  const byTask = new Map();
  const byPath = new Map();
  const reasons = new Map();
  const missed = [];
  for (const entity of entities) {
    const picked = resolved.get(entity.key);
    if (!picked) {
      // 预算用完没判完的，照实说是预算的原因，不说成「没找到」：用户手上有图的话上传最省事。
      const why = entity.outOfBudget ? '检索预算用完，没有判完' : '没找到符合要求的参考图';
      missed.push({ tag: entity.outOfBudget ? 'warn' : 'fail', text: entity.note, note: why });
      deps.emit(session, 'think', entity.note + '：' + why, { level: 'warn' });
      session.questions.push('「' + entity.note + '」' + (entity.outOfBudget ? '检索预算用完，没有找到参考图' : '没找到符合要求的参考图') + '，如果一致性要求高请手动上传。');
      continue;
    }
    const id = await registerPickedRef(session, deps, entity, picked, byPath);
    reasons.set(id, picked.reason || '');
    byUrl.set(picked.url, id);
    if (entity.direct) byUrl.set(entity.query, id);
    for (const name of entity.taskNames) if (name) byTask.set(name, id);
  }
  missed.push(...unsearched);

  settleImageRefs(session, deps, plannedRefs, byUrl, byTask, knownTasks);
  session.refSheet = null;
  if (!session.refs.length) {
    deps.emit(session, 'think', '没有可用的参考图，本轮全部按文生图走（' + refBudgetLine(budget) + '）', { level: 'warn' });
    return;
  }
  deps.emit(session, 'think', '参考图就绪：' + session.refs.map((ref) => ref.id).join('、') + '（' + refBudgetLine(budget) + '）', {
    detail: detail('参考图', [
      kv('检索预算', refBudgetLine(budget)),
      thumbs(
        '最终选用（' + session.refs.length + ' 张）',
        session.refs.map((ref) => ({
          key: 'refs/' + ref.file,
          title: ref.id + ' · ' + (ref.note || ''),
          note: ref.source || '',
          tag: 'pass',
          text: reasons.get(ref.id) || '',
        })),
      ),
      missed.length ? list('没找到的', missed) : null,
    ]),
  });
}

// ---------------------------------------------------------------- 角色基准图
//
// 多图各画各的必然漂。实测一组四格漫画：同一只狐狸从"巴掌大蹲纸箱"一路画到"大型犬四足着地"，
// 同一个少女从圆脸齐肩内扣画到微卷长发，而四张图的 hard 全部 5/5 通过——逐图评审看不到别的图，
// 每张单看都没毛病。唯一能真正锁住主体的办法，是先出一张角色设定图，让后面每张都以它为外观基准。

// 上限 2 个：每多一个主体就多跑一次生图，再多会把整组图的出图时间拖垮。
const MAX_CHARACTER_REFS = 2;

function normalizeCharacterRefs(data) {
  const raw = data && Array.isArray(data.character_refs) ? data.character_refs : [];
  const out = [];
  const used = new Set();
  for (const item of raw) {
    if (out.length >= MAX_CHARACTER_REFS) break;
    if (!item || typeof item !== 'object') continue;
    const prompt = String(item.prompt || '').trim();
    const key = String(item.key || '').trim().toLowerCase();
    if (!prompt || !key || used.has(key)) continue;
    used.add(key);
    out.push({
      key,
      note: String(item.note || key).trim(),
      prompt,
      images: Array.isArray(item.images)
        ? item.images.map((id) => String(id || '').trim().toUpperCase()).filter(Boolean)
        : [],
    });
  }
  return out;
}

// 生成一张角色设定图并登记成 R 编号参考图。
// 串行执行：并发时两个 worker 会同时算出同一个 R 编号，把彼此的图覆盖掉。
async function makeCharacterSheet(session, item, deps) {
  const started = Date.now();
  const result = await h3.generate(deps.config, {
    prompt: item.prompt,
    // 设定图只需要当参考，2K 足够；4K 纯属白等。
    aspectRatio: '3:4',
    area: '2K',
    n: 1,
  });
  const first = (result.items || []).find((entry) => entry && !entry.error && entry.url);
  if (!first) return null;
  await deps.ensureDir(deps.dirs.refs);
  const id = 'R' + (session.refs.length + 1);
  // 角色基准图同样按实际字节定扩展名，理由同候选图。
  const refBuffer = await h3.download(first.url, null);
  const file = id + extensionFor(refBuffer);
  const path = join(deps.dirs.refs, file);
  await writeFile(path, refBuffer);
  const ditMs = Date.now() - started;
  session.cost.ditImages += 1;
  session.cost.ditMs += ditMs;
  if (result.usage) session.cost.usage = mergeUsage(session.cost.usage, result.usage);
  const record = {
    id,
    file,
    path,
    note: item.note,
    source: '角色设定图',
    origin: 'generated',
    images: item.images,
  };
  session.refs.push(record);
  deps.emit(session, 'paint', '角色设定图 ' + id + '（' + item.note + '）· ' + seconds(ditMs), {
    durMs: ditMs,
    detail: detail('角色设定图', [
      kv('编号', id),
      kv('主体', item.note),
      kv('用于', item.images.length ? item.images.join('、') : '全部图'),
      kv('尺寸', first.size || '2K'),
      kv('耗时', seconds(ditMs)),
      text('设定 prompt', item.prompt),
    ]),
  });
  return record;
}

// 在正式出故事图之前先把角色基准图准备好，并绑到相关图上。
async function buildCharacterRefs(session, deps) {
  session.characterRefs = [];
  const list = normalizeCharacterRefs(session.plan);
  const live = session.images.filter((image) => !image.blocked);
  // 只有一张图时没有"跨图"可言，planner 误判也不该多烧一次生图。
  if (!list.length || live.length < 2) return;

  for (const item of list) {
    try {
      const made = await makeCharacterSheet(session, item, deps);
      if (!made) {
        deps.emit(session, 'think', '角色设定图「' + item.note + '」没返回可用图片，本组按原样走', { level: 'warn' });
        continue;
      }
      session.characterRefs.push(made);
      const scope = item.images.length ? live.filter((image) => item.images.includes(image.id)) : live;
      for (const image of scope) {
        image.spec.refs = dedupe([...(image.spec.refs || []), made.id]);
        image.spec.characterRefs = dedupe([...(image.spec.characterRefs || []), made.id]);
        // 有参考图却还走 t2i，参考图根本不会被送进模型，等于白生成。
        image.spec.entry = 'edit';
      }
    } catch (error) {
      // 角色图失败绝不能卡住整组图：降级成原来的各画各的，并在交付里说清楚。
      deps.emit(session, 'think', '角色设定图「' + item.note + '」生成失败：' + describeError(error), { level: 'warn' });
      session.questions.push('角色设定图「' + item.note + '」没生成成功，这组图的' + item.note + '一致性可能下降。');
    }
  }

  if (!session.characterRefs.length) return;
  // 参考图集合变了，看图材料要重做，否则评审还在拿旧的对比图。
  session.refSheet = null;
  deps.emit(session, 'think', '角色基准图就绪：' + session.characterRefs.map((ref) => ref.note).join('、'), {
    detail: detail('角色基准', [
      thumbs(
        '角色设定图（后续每张图的外观基准）',
        session.characterRefs.map((ref) => ({
          key: 'refs/' + ref.file,
          title: ref.id + ' · ' + ref.note,
          note: '用于 ' + (ref.images.length ? ref.images.join('、') : '全部图'),
          tag: 'pass',
        })),
      ),
    ]),
  });
}

// 参考图对比图只生成一次，之后所有轮次复用。
async function ensureRefSheet(session, deps) {
  if (!session.refs.length) return null;
  if (session.refSheet) return session.refSheet;
  try {
    await mkdir(deps.dirs.sheets, { recursive: true });
    const result = await review.buildReferenceSheet(session.refs, join(deps.dirs.sheets, 'refs-sheet.png'));
    session.refSheet = result ? result.sheet : null;
  } catch {
    session.refSheet = null;
  }
  return session.refSheet;
}

export async function runIncrementalEdit(session, instruction, deps) {
  // 上一轮的中断原因不能带进这一轮：以前一轮失败之后，后面每一轮哪怕交付成功，会话也一直显示「失败」。
  session.fatal = '';
  // 参考图卡片上点了「用这张参考图生成 GIF」：直接出帧，不用编辑节点再理解一遍。
  const confirmed = confirmTarget(instruction);
  const confirmedImage = confirmed ? session.images.find((item) => item.id === confirmed && isAnimation(item)) : null;
  if (confirmedImage) {
    await editAnimation(session, confirmedImage, { animation: { start: true }, promptGiven: false }, deps);
    return;
  }
  const target = await editPlanNode(session, instruction, deps);
  if (isCancelled(session)) return;
  if (!target) {
    deps.emit(session, 'edit', '没能定位到要改的图，已把问题放进交付');
    session.questions.push('增量编辑没解析出目标图：' + instruction);
    await deliver(session, deps);
    return;
  }
  const image = session.images.find((item) => item.id === target.imageId);
  if (!image) {
    session.questions.push('增量编辑引用了不存在的图：' + target.imageId);
    await deliver(session, deps);
    return;
  }
  if (isAnimation(image) && (await editAnimation(session, image, target, deps))) return;
  if (!isAnimation(image) && (await editMotionGif(session, image, target, deps))) return;
  if (!isAnimation(image) && (await editPanelGif(session, image, target, instruction, deps))) return;
  const hadQr = ((image.spec && image.spec.qrCodes) || []).length > 0;
  // 用户要把码去掉：清掉码的要求，H-qr 跟着摘掉，之后的编辑也不再追加二维码的画法要求。
  if (target.qrRemove) image.spec.qrCodes = [];
  else if (target.qrCodes) {
    image.spec.qrCodes = normalizeQrCodes(target.qrCodes, qrSources(session, [instruction]));
    const unverified = image.spec.qrCodes.filter((item) => item.content && !item.verbatim);
    if (unverified.length) {
      deps.emit(
        session,
        'edit',
        image.id + ' 的二维码内容在你说过的话里找不到，不贴真码：' + unverified.map((item) => '「' + item.content + '」').join('、'),
        { level: 'warn' },
      );
    }
  }
  // 图表：先把这次对图表的改动并进规格（数据、类型、位置）。放在改字之前：只改字时也会在底图上重画图表。
  const hadCharts = hasCharts(image);
  if (target.charts) applyChartPatches(session, image, target.charts, instruction, deps);
  // 文字：先把这次对文字的改动并进规格（内容、位置、书体）。
  if (target.textLayers) applyTextPatches(session, image, target.textLayers, deps);
  // 只改字：程序排的字直接在不带字的底图上重新排，不重新生图；模型画的字先让模型擦掉，再由程序排。
  // 1.9.0 以前的会话没有 textOverlay，用户说「漏了 36 个字，补上」时编辑节点不一定写 text_layers：按已有的文字层补出来。
  if (target.textOnly && !image.spec.textOverlay && layerTexts(image.spec.textLayers).length) {
    image.spec.textOverlay = normalizeTextOverlay(null, image.spec.textLayers, [session.instruction, image.title].filter(Boolean).join(' '));
  }
  if (target.textOnly && overlayLayers(image).length) {
    if (isOverlay(image)) {
      const done = await replaceTextInPlace(session, image, deps);
      if (isCancelled(session)) return;
      if (!done) restoreLastDelivered(session, image, deps);
      await deliver(session, deps);
      return;
    }
    // 不知道字该放哪（规划没写排法、编辑节点也没给 box）的短字退回让模型照新内容改：按默认位置排，会在画面正中
    // 压一大块字。长文、竖排、书法不受这个限制：字本身就是画面的主体，默认位置就是载体中间的一大块。
    if (!canPlaceText(image)) {
      if (!target.promptGiven) target.prompt = rewriteTextPrompt(image, target.textLayers);
    } else {
      const eraseFrom =
        findCandidate(image, target.candidateId) || image.chosen || lastCandidate(image) || lastDelivered(session, image, deps);
      enterOverlay(session, image, '用户要改模型画的字');
      deps.emit(session, 'edit', image.id + ' 模型画的字要改：先让模型把字擦掉，再由程序按原文排字', { level: 'info' });
      image.spec.checklist = withQrCheck(image.spec.checklist, image.spec.qrCodes);
      image.roundBase = (image.roundBase || 0) + (image.rounds || []).length;
      image.rounds = [];
      image.status = 'running';
      image.chosen = null;
      image.pendingAction = eraseFrom
        ? {
            type: 'edit',
            prompt: eraseTextPrompt(image),
            parentId: eraseFrom.id,
            parentPath: eraseFrom.path,
            parentStats: (eraseFrom.program && eraseFrom.program.stats) || null,
            refs: [],
            instruction,
          }
        : { type: 'generate', prompt: promptFor(image), refs: image.spec.refs, parentId: null };
      await runImage(session, image, deps);
      if (isCancelled(session)) return;
      await deliver(session, deps);
      return;
    }
  }
  // 只改图表：在不带图表的底图上按新的数据重画，不重新生图。底图上那块地方不空（原来没有图表、这次新加一张，
  // 或者挪到了别处），退回让模型先在那里留出一块空白面板，再由程序画图表。
  if (target.chartOnly && (hadCharts || hasCharts(image))) {
    const outcome = await replaceChartInPlace(session, image, deps);
    if (isCancelled(session)) return;
    if (outcome !== 'needs_panel') {
      if (outcome !== 'done') restoreLastDelivered(session, image, deps);
      await deliver(session, deps);
      return;
    }
    if (!target.promptGiven) target.prompt = chartPanelPrompt(image);
    deps.emit(session, 'edit', image.id + ' 底图上预留给图表的地方不空：先让模型在那里留出一块空白面板，再由程序画图表');
  }
  // 只是补（或换）二维码内容：不重新生图，直接在上一版交付图上把码换成真码。
  // 图里原来没有码的不走这条路——那是「加一个码」，得让模型先画出来。
  if (target.qrOnly && hadQr && !target.qrRemove) {
    image.spec.checklist = withQrCheck(image.spec.checklist, image.spec.qrCodes);
    if (qrContents(image.spec).length) await replaceQrInPlace(session, image, deps);
    else deps.emit(session, 'edit', image.id + ' 这次没有可以贴的二维码内容，原图保持不变', { level: 'warn' });
    if (isCancelled(session)) return;
    await deliver(session, deps);
    return;
  }
  // 参考图：编辑节点要求重新检索的，真的去搜、下载、筛选，找到的登记成新的 R 编号并用到这次修改里；
  // 用户给的图片地址同样先下载校验。以前这一步完全没有：追问「参考图不对，重新找」时编辑节点只能凭记忆
  // 写一个网址，网址原样交给接口，接口取不到，同一个请求连败 6 轮（真机 20261112-8a442a）。
  const refPlan = await prepareEditRefs(session, image, target, instruction, deps);
  if (isCancelled(session)) return;
  if (target.refsOnly && refPlan.searched && !refPlan.added.length) {
    // 只是要重新找参考图，却一张新的都没找到：照原样再画一遍只会得到同样的图，不浪费生图请求。
    deps.emit(session, 'edit', image.id + ' 重新检索没找到新的参考图，这次没有重新生成', { level: 'warn' });
    restoreLastDelivered(session, image, deps);
    await deliver(session, deps);
    return;
  }
  image.spec.prompt = target.prompt || image.spec.prompt;
  image.spec.entry = 'edit';
  // 只带编辑节点点名的参考图（加上这次重新检索找到的）。把上一版的 R1..R4 一起留下，模型会分不清哪张是要改的底图，
  // 转而照着参考图重画一张全新的图——实测「加个标题」被画成了另一台车、另一个人、另一个背景。
  image.spec.refs = refPlan.refs;
  if (target.checklist && target.checklist.length) image.spec.checklist = target.checklist;
  // 编辑节点写的清单不带 H-qr；图里要放真码的，每一轮编辑都照样要验。
  image.spec.checklist = withQrCheck(image.spec.checklist, image.spec.qrCodes);
  // 程序排字的图同理：编辑节点写的清单不带 H-text、H-notext。
  if (isOverlay(image)) image.spec.checklist = overlayChecklist(image.spec.checklist, image.spec.textLayers);
  // 程序画图表的图也一样：编辑节点写的清单不带 H-chart、H-nochart。
  image.spec.checklist = chartChecklist(image.spec.checklist, imageCharts(image));
  image.spec.checklist = withWhiteCheck(image.spec.checklist, wantsWhite(session, image));
  // 这次明确要改颜色、光线：上一版的颜色不再是标准，不拿它当色彩基准，改完以后重新选。
  if (image.colorAnchor && COLOR_CHANGE_RE.test(String(instruction || ''))) {
    image.colorAnchor = null;
    deps.emit(session, 'edit', image.id + ' 这次要改颜色或光线，不拿上一版当色彩基准');
  }
  // 组图 GIF 补过过渡格的，改完组图要按新的组图重补（见下面 runImage 之后）。
  const hadTweens = Boolean(image.panelTweens && image.panelTweens.pairs.some((pair) => pair.status === 'passed' || pair.status === 'unreviewed'));
  // 父图必须在清空轮次之前解析出来。清空之后 findCandidate 就找不到上一版的候选了，
  // 编辑请求会不带原图，而轨迹上照样写着「在 A-r1-g1 上编辑」。
  const parent =
    findCandidate(image, target.candidateId) ||
    image.chosen ||
    lastCandidate(image) ||
    lastDelivered(session, image, deps);
  // 轮次显示从第 1 轮重新开始，但候选文件名要接着往上排，
  // 否则新候选又叫 A-r1-g0，会把上一版交付的同名文件从磁盘上盖掉。
  image.roundBase = (image.roundBase || 0) + (image.rounds || []).length;
  image.rounds = [];
  image.status = 'running';
  image.chosen = null;
  image.pendingAction = {
    type: 'edit',
    prompt: target.prompt,
    parentId: parent ? parent.id : null,
    // 程序排字的图要在不带字的底图上改，字改完再重新排。
    parentPath: parent ? parentImagePath(image, parent) : null,
    // 轮次马上要被清空，父图对象之后再也取不到，统计必须现在抄一份带下去。
    // 少了这一行，编辑轮的 parentStats 恒为 null，漂移判定会退回绝对模式。
    parentStats: (parent && parent.program && parent.program.stats) || null,
    refs: image.spec.refs,
    instruction: instruction,
  };
  if (!parent) {
    deps.emit(session, 'edit', '没找到要编辑的那张原图，这次只能按编辑指令重新生成', { level: 'warn' });
  }
  await runImage(session, image, deps);
  if (isCancelled(session)) return;
  // 要拼成 GIF 的组图改过了：原来补过过渡格的，按新的组图重新补。
  if (image.spec.panelGif && !isAnimation(image) && image.chosen && hadTweens) {
    await ensurePanelTweens(session, image, deps, tweenHooks(), { mode: 'make' });
    if (isCancelled(session)) return;
  }
  await deliver(session, deps);
}

// 这个会话做过的参考图检索：规划时的 ref_queries，加上之后追问里重新检索的。
function refHistoryQueries(session) {
  return [...normalizeRefQueries(session.plan && session.plan.ref_queries), ...(session.editRefQueries || [])];
}

// 每个检索项的结果（找到哪张 R，或没找到），给编辑节点看。同一个 task_name 检索过几次都算：
// 首轮找到了、追问里重搜没找到的，它仍然有那张参考图；被用户点名替换掉的图不再算数。
function refHistory(session) {
  const byTask = new Map();
  for (const query of refHistoryQueries(session)) {
    const entry = byTask.get(query.task_name) || { task_name: query.task_name, query: query.query, notes: [] };
    entry.query = query.query;
    entry.notes.push(query.query);
    byTask.set(query.task_name, entry);
  }
  const replaced = new Set((session.editRefQueries || []).map((query) => query.replaces).filter(Boolean));
  return [...byTask.values()].map((entry) => {
    const ref = session.refs
      .slice()
      .reverse()
      .find((item) => item.origin !== 'user' && !replaced.has(item.id) && entry.notes.indexOf(item.note) >= 0);
    return { task_name: entry.task_name, query: entry.query, ref: ref ? ref.id : '' };
  });
}

// 编辑这一轮要用的参考图。返回 { refs, added, searched }：refs 是交给生图的 R 编号；
// added 是这次新登记的（重新检索或用户地址下载来的）；searched 表示这次确实发起了检索。
async function prepareEditRefs(session, image, target, instruction, deps) {
  const queries = target.refQueries || [];
  const named = keepUserUrls(
    session,
    image,
    dedupe((target.refs || []).filter((ref) => typeof ref === 'string' && ref.trim()).map((ref) => ref.trim())),
    deps,
    [instruction],
  );
  const urls = named.filter((ref) => /^https?:\/\//i.test(ref));
  const byTask = new Map();
  for (const item of refHistory(session)) if (item.ref) byTask.set(item.task_name, item.ref);
  const result = { refs: [], added: [], searched: queries.length > 0 };
  // 用户点名说不对的旧参考图：新的检索排除它，这次修改也不再带它。
  const replaced = new Set(queries.map((item) => item.replaces).filter(Boolean));
  const byUrl = new Map();

  if (queries.length || urls.length) {
    const exclude = new Set(session.refs.filter((ref) => replaced.has(ref.id) && ref.source).map((ref) => ref.source));
    // 追问里的检索同样按编辑节点给的预算走（没写就用默认值）。
    const budget = makeRefBudget(normalizeRefBudget(target.refBudget, queries.length));
    if (queries.length && !budget.limit) {
      budget.stopped = queries.map((item) => item.query);
      deps.emit(session, 'think', '编辑节点写了 ' + queries.length + ' 项检索，但检索预算是 0，这次不检索', { level: 'warn' });
    }
    const hits = queries.length && budget.limit ? await runRefSearch(session, queries, deps, { ask: false, budget }) : [];
    const entities = refEntities(session, hits, queries, {
      directUrls: urls,
      exclude,
      keyPrefix: 't' + (session.turns || []).length + 'q',
    });
    const resolved = entities.length ? await resolveEntities(session, entities, deps, budget) : new Map();
    result.budget = budget;
    const before = new Set(session.refs.map((ref) => ref.id));
    const byPath = new Map();
    const found = [];
    const missed = [];
    const missedBudget = new Set(budget.stopped);
    for (const entity of entities) {
      const picked = resolved.get(entity.key);
      if (!picked) {
        if (entity.outOfBudget) missedBudget.add(entity.note);
        else missed.push(entity.note);
        deps.emit(session, 'think', entity.note + '：' + (entity.outOfBudget ? '检索预算用完，没有判完' : '没找到符合要求的参考图'), { level: 'warn' });
        continue;
      }
      const id = await registerPickedRef(session, deps, entity, picked, byPath);
      if (entity.direct) byUrl.set(entity.query, id);
      for (const name of entity.taskNames) if (name) byTask.set(name, id);
      if (!before.has(id) && result.added.indexOf(id) < 0) result.added.push(id);
      found.push({ id, entity });
    }
    // 一张候选都没搜回来的检索项不会生成实体，也要算「没找到」（预算不够没搜的单独算）。
    const foundTasks = new Set(found.flatMap((item) => item.entity.taskNames));
    for (const query of queries) {
      const listed = entities.some((entity) => entity.taskNames.indexOf(query.task_name) >= 0);
      if (!listed && !foundTasks.has(query.task_name) && !missedBudget.has(query.query)) missed.push(query.query);
    }
    // 检索过的项记下来：下次追问时编辑节点能看到哪些找到了、哪些没找到。
    session.editRefQueries = [...(session.editRefQueries || []), ...queries].slice(-12);
    // 之前「没找到」的提问，这次找到了就撤掉，免得交付里还挂着一句过期的「请手动上传」。
    const resolvedTasks = new Set(found.flatMap((item) => item.entity.taskNames));
    const staleNotes = refHistoryQueries(session)
      .filter((query) => resolvedTasks.has(query.task_name))
      .map((query) => '「' + query.query + '」没找到');
    session.questions = (session.questions || []).filter((question) => !staleNotes.some((note) => question.includes(note)));
    for (const note of missed) {
      const question = '「' + note + '」重新检索后仍没找到符合要求的参考图，可以在面板里手动上传一张。';
      if (session.questions.indexOf(question) < 0) session.questions.push(question);
    }
    for (const note of missedBudget) {
      const question = '「' + note + '」超出了这次的检索预算，没有找到参考图，可以在面板里手动上传一张。';
      if (session.questions.indexOf(question) < 0) session.questions.push(question);
    }
    if (found.length || missed.length) {
      deps.emit(session, 'think', '重新找参考图：' + (found.length ? '找到 ' + found.map((item) => item.id).join('、') : '一张都没找到'), {
        level: found.length ? 'info' : 'warn',
        detail: detail('追问里的参考图', [
          thumbs(
            '这次用上的（' + found.length + ' 张）',
            found.map((item) => {
              const ref = session.refs.find((one) => one.id === item.id) || {};
              return { key: 'refs/' + ref.file, title: item.id + ' · ' + item.entity.note, note: ref.source || '', tag: 'pass', text: '' };
            }),
          ),
          missed.length ? list('没找到的', missed.map((note) => ({ tag: 'fail', text: note }))) : null,
          replaced.size ? kv('不再使用', [...replaced].join('、')) : null,
        ]),
      });
    }
  }

  const refs = [];
  for (const ref of named) {
    if (/^https?:\/\//i.test(ref)) {
      // 下载不了的地址上面已经说过「没找到」，这里直接跳过。
      const id = byUrl.get(ref);
      if (id) refs.push(id);
      continue;
    }
    if (/^R\d+$/i.test(ref)) {
      const id = ref.toUpperCase();
      if (session.refs.some((item) => item.id === id)) refs.push(id);
      else deps.emit(session, 'edit', image.id + ' 的编辑引用了不存在的参考图 ' + id + '，已忽略', { level: 'warn' });
      continue;
    }
    let id = byTask.get(ref);
    if (!id) {
      for (const [name, value] of byTask) if (canonicalRef(name) === canonicalRef(ref)) id = value;
    }
    if (id) refs.push(id);
    else if (!queries.some((query) => canonicalRef(query.task_name) === canonicalRef(ref))) {
      deps.emit(session, 'edit', image.id + ' 的参考图标识「' + String(ref).slice(0, 40) + '」没对上任何参考图，已忽略', { level: 'warn' });
    }
  }
  // 这次重新检索找到的图一定带上：编辑节点漏写了 task_name，重新找图就白找了。
  for (const id of result.added) if (refs.indexOf(id) < 0) refs.push(id);
  result.refs = dedupe(refs).filter((id) => !replaced.has(id));
  return result;
}

// 这一轮没有重新生成时，把上一版交付的图接回来再交付一次（上一轮可能失败过，image.chosen 已经清空）。
function restoreLastDelivered(session, image, deps) {
  if (image.chosen) return;
  const last = lastDelivered(session, image, deps);
  if (!last) return;
  image.chosen = last;
  image.status = last.status === 'passed' ? 'passed' : 'unpassed';
  image.chosenReason = '这一轮没有重新生成，沿用上一版交付';
  // 中途停下的说明跟着那张图走：上一轮失败留下的原因和这张图无关。
  image.interrupted = last.interrupted || '';
}

// 在上一版交付图上把二维码换成真码，不重新生图（用户在同一会话里补了一句码的内容）。
// 换成了：起一个新轮次、只含这一张候选，评审结论沿用底图的、把 H-qr 记成通过——画面别的地方一个像素都没动，
// 没理由再花几分钟重新评审。没换成：原图和轮次都不动，原因记在 image.qrAttempt 上，交付时告诉用户。
async function replaceQrInPlace(session, image, deps) {
  const contents = qrContents(image.spec);
  const base = image.chosen || lastCandidate(image) || lastDelivered(session, image, deps);
  image.qrAttempt = null;
  if (!base || !base.path) {
    image.qrAttempt = { contents, reasonText: '找不到上一版交付的图' };
    deps.emit(session, 'edit', image.id + ' 找不到上一版交付的图，没法直接换码', { level: 'warn' });
    return false;
  }
  const startedAt = Date.now();
  deps.emit(session, 'edit', image.id + ' 只换二维码：直接在 ' + (base.id || '上一版交付图') + ' 上换成真码，不重新生图', {
    detail: detail('只换二维码', [
      kv('底图', base.id || '上一版交付图'),
      list('要放的内容', contents.map((content) => ({ text: content }))),
    ]),
  });
  let buffer;
  // 图表、文字是程序画上去的：从画之前的底图开始换码，换完再把图表、文字重新画上去。
  // 从交付图开始的话，图表要画在已有的图表上，那块地方不空，图表就画不上了。
  const from = (hasCharts(image) || isOverlay(image)) && base.basePath ? base.basePath : base.path;
  try {
    buffer = await readFile(from);
  } catch (error) {
    image.qrAttempt = { contents, reasonText: '读不到上一版交付的图：' + describeError(error) };
    deps.emit(session, 'edit', image.id + ' ' + image.qrAttempt.reasonText, { level: 'error' });
    return false;
  }
  const roundBase = (image.roundBase || 0) + (image.rounds || []).length;
  const id = image.id + '-r' + (roundBase + 1) + '-g0';
  const candidate = {
    id,
    path: from,
    file: id + extensionFor(buffer),
    size: base.size,
    requestId: base.requestId,
    revisedPrompt: base.revisedPrompt,
    parentId: base.id || null,
    parentPath: from,
    parentStats: (base.program && base.program.stats) || null,
    actionType: 'qr',
    actionPrompt: base.actionPrompt || image.spec.prompt,
    round: 0,
    createdAt: Date.now(),
    buffer,
    program: {},
    checks: [],
  };
  await programChecks(session, image, candidate, deps);
  const qr = candidate.program && candidate.program.qr;
  if (!qr || qr.status !== 'real') {
    const why = qr ? qrFailText(qr) : (candidate.program && candidate.program.error) || '未知原因';
    image.qrAttempt = { contents, reasonText: '在原图上换码没成功：' + why };
    deps.emit(session, 'edit', image.id + ' 二维码没换成：' + why + '。原图保持不变', { level: 'warn', durMs: Date.now() - startedAt });
    return false;
  }
  // 原图里本来就是这枚码（用户把同一个内容又说了一遍）：没有生成新文件，复制一份，
  // 让候选的 file 在 images/ 下真实存在（重启后靠它找回这张图）。
  if (candidate.path === from) {
    const copyPath = join(deps.dirs.images, candidate.file);
    await writeFile(copyPath, buffer);
    candidate.path = copyPath;
  }
  // 贴码前的原图是底图那张（可能在 deliver/vN/ 下），不是这个候选名下的文件——那个名字从没写过盘。
  candidate.originalFile = base.file && from === join(deps.dirs.images, base.file) ? base.file : null;
  candidate.originalPath = from;
  candidate.verdict = carryVerdict(base.verdict, qr);
  const previous = image.status;
  image.roundBase = roundBase;
  image.rounds = [
    {
      index: 0,
      action: { type: 'qr', prompt: '', parentId: base.id || null, refs: [] },
      candidates: [candidate],
      verdict: { note: '在原图上换成真码，扫码实测通过' },
      startedAt,
    },
  ];
  image.chosen = candidate;
  image.status = candidate.verdict
    ? candidate.verdict.hardTotal > 0 && !candidate.verdict.hardFailed.length
      ? 'passed'
      : 'unpassed'
    : previous === 'passed'
      ? 'passed'
      : 'unpassed';
  image.chosenReason = '在上一版交付图上把二维码换成真码，没有重新生图；扫码实测内容为「' + contents.join('」「') + '」';
  deps.emit(session, 'edit', image.id + ' 二维码已在原图上换成真码，扫码实测通过', { durMs: Date.now() - startedAt });
  return true;
}

// 只换码时沿用底图的评审结论，把 H-qr 记成通过（没有这一项的补上，计入 hardTotal）。
function carryVerdict(verdict, qr) {
  if (!verdict) return null;
  const copy = JSON.parse(JSON.stringify(verdict));
  const had = copy.checks && copy.checks['H-qr'];
  copy.checks = { ...(copy.checks || {}), 'H-qr': { result: 'pass', note: '扫码实测：' + qr.items.map((item) => item.content).join('、') } };
  copy.hardFailed = (copy.hardFailed || []).filter((id) => id !== 'H-qr');
  if (!had) {
    copy.hardTotal = (copy.hardTotal || 0) + 1;
    copy.hardPassed = (copy.hardPassed || 0) + 1;
  } else if (had.result === 'fail') {
    copy.hardPassed = (copy.hardPassed || 0) + 1;
  }
  return copy;
}

// 编辑节点写的文字改动（text_layers）：按 index 改已有的段落，没有 index 的是新加的一段，remove 是删掉。
// 改完同步 text_layers 和 T 项；程序排字模式下底图 prompt 里的留白位置也跟着变。
const TEXT_PATCH_FIELDS = ['box', 'direction', 'font', 'color', 'align', 'punctuation', 'surface', 'role', 'indent', 'rule', 'part'];

function applyTextPatches(session, image, patches, deps) {
  // 1.9.0 以前的会话没有 textOverlay：先按已有的 text_layers 补出来，否则按 index 改字体这类改动找不到段落，
  // 文字层会被整个清空。
  const overlay =
    image.spec.textOverlay ||
    normalizeTextOverlay(null, image.spec.textLayers, [session.instruction, image.title].filter(Boolean).join(' ')) ||
    { use: false, base: {}, layers: [], planned: false };
  const layers = overlay.layers.slice();
  const removed = new Set();
  for (const patch of patches || []) {
    if (!patch || typeof patch !== 'object') continue;
    const index = Number.isInteger(patch.index) ? patch.index : -1;
    const newText = typeof patch.text === 'string' ? patch.text.trim() : '';
    if (index >= 0 && index < layers.length) {
      if (patch.remove === true) {
        removed.add(index);
        continue;
      }
      const merged = { ...layers[index] };
      for (const key of TEXT_PATCH_FIELDS) if (patch[key] !== undefined && patch[key] !== null && patch[key] !== '') merged[key] = patch[key];
      layers[index] = normalizeTextLayer(merged, newText || layers[index].text);
    } else if (newText) {
      layers.push(normalizeTextLayer(patch, newText));
    }
  }
  const next = layers.filter((_, index) => !removed.has(index)).slice(0, MAX_TEXT_LAYERS);
  const placed = (patches || []).some((patch) => patch && Array.isArray(patch.box));
  image.spec.textOverlay = { ...overlay, layers: next, planned: Boolean(overlay.planned || placed) };
  image.spec.textLayers = next.map((layer) => layer.text);
  const rest = (image.spec.checklist || []).filter((item) => !/^T\d+$/.test(item.id));
  image.spec.checklist = textChecks(image.spec.textLayers).concat(rest);
  if (isOverlay(image)) {
    image.spec.basePrompt = composeBasePrompt(image.spec, session.instruction);
    image.spec.checklist = overlayChecklist(image.spec.checklist, image.spec.textLayers);
  }
  // 文字层改过了，按版面读一遍的结果也要跟着更新：评审看到的提醒不能是上一版的。
  image.spec.readingProblems = readingProblems(session, [image]);
  deps.emit(session, 'edit', image.id + ' 文字改成：' + next.map((layer) => '「' + shortText(layer.text, 20) + '」').join('、'), {
    detail: detail('文字改动 · ' + image.id, [
      ...next.map((layer, index) =>
        group('第 ' + index + ' 段', [
          kv('内容', shortText(layer.text, 60)),
          kv('位置', describeBox(layer.box)),
          kv('排法', (layer.direction === 'vertical' ? '竖排' : '横排') + ' · ' + FONT_KINDS[layer.font].label + (layer.color ? ' · ' + layer.color : '')),
        ]),
      ),
    ]),
  });
}

// 规划没写字放在哪、编辑节点也没给 box 时，改字只能交给模型：编辑指令里写清改成什么、要换的样子。
function rewriteTextPrompt(image, patches) {
  const asks = [];
  for (const patch of patches || []) {
    if (!patch || typeof patch !== 'object') continue;
    if (patch.font) asks.push('字体改成' + FONT_KINDS[normalizeFontKind(patch.font)].label);
    if (patch.direction === 'vertical') asks.push('改成竖排');
    if (patch.direction === 'horizontal') asks.push('改成横排');
    if (patch.color) asks.push('文字颜色改成 ' + patch.color);
  }
  const texts = layerTexts(image.spec.textLayers);
  return (
    '把画面里的文字改成' +
    texts.map((value) => '「' + value + '」').join('、') +
    '，逐字照写、字形正确、清晰可读' +
    (asks.length ? '，' + dedupe(asks).join('，') : '，字体风格与原来一致') +
    '，位置和大小与原来一致；除文字以外画面的一切保持完全不变。'
  );
}

// 让模型把它自己画的字擦掉：原来写字的载体还原成干净的表面，别的都不动。擦完由程序排字。
function eraseTextPrompt(image) {
  const surfaces = dedupe(overlayLayers(image).map((layer) => layer.surface)).join('、');
  return (
    '把画面里所有的文字、字母、数字、标点、笔迹和印章都擦掉，原来写字的地方还原成干净、空白的' +
    (surfaces || '表面') +
    '，纹理和明暗与周围一致；除此之外画面的一切（构图、光线、颜色、物体、背景）保持完全不变。'
  );
}

// 在不带字的底图上按新的文字要求重新排字，不重新生图。成了：起一个只含这一张候选的新轮次，评审结论沿用上一版的，
// 文字相关的几项记成通过（画面别的地方一个像素都没动）。没成：原图和轮次都不动，原因记在 image.textAttempt 上。
async function replaceTextInPlace(session, image, deps) {
  const base = image.chosen || lastCandidate(image) || lastDelivered(session, image, deps);
  image.textAttempt = null;
  const basePath = base && base.basePath;
  if (!basePath) {
    image.textAttempt = { reasonText: '找不到上一版不带字的底图' };
    deps.emit(session, 'edit', image.id + ' 找不到上一版不带字的底图，没法直接改字', { level: 'warn' });
    session.questions.push(image.id + ' 找不到不带字的底图，这次没有改字。可以回复「重画」重新生成这张图');
    return false;
  }
  const startedAt = Date.now();
  deps.emit(session, 'edit', image.id + ' 只改文字：在不带字的底图上重新排字，不重新生图');
  let buffer;
  try {
    buffer = await readFile(basePath);
  } catch (error) {
    image.textAttempt = { reasonText: '读不到不带字的底图：' + describeError(error) };
    deps.emit(session, 'edit', image.id + ' ' + image.textAttempt.reasonText, { level: 'error' });
    session.questions.push(image.id + ' ' + image.textAttempt.reasonText + '，这次没有改字');
    return false;
  }
  const roundBase = (image.roundBase || 0) + (image.rounds || []).length;
  const id = image.id + '-r' + (roundBase + 1) + '-g0';
  const candidate = {
    id,
    path: basePath,
    file: basePath.split(/[\\/]/).pop(),
    size: base.size,
    requestId: base.requestId,
    revisedPrompt: base.revisedPrompt,
    parentId: base.id || null,
    parentPath: basePath,
    parentStats: (base.program && base.program.stats) || null,
    actionType: 'text',
    actionPrompt: base.actionPrompt || promptFor(image),
    round: 0,
    createdAt: Date.now(),
    buffer,
    program: {},
    checks: [],
  };
  await programChecks(session, image, candidate, deps);
  const typed = candidate.program && candidate.program.text;
  if (!typed || typed.status !== 'overlay') {
    const why = typed ? textFailText(typed) : (candidate.program && candidate.program.error) || '未知原因';
    image.textAttempt = { reasonText: why };
    deps.emit(session, 'edit', image.id + ' 字没排上：' + why + '。图保持上一版', { level: 'warn', durMs: Date.now() - startedAt });
    session.questions.push(image.id + ' 按新的要求排不下这段字（' + why + '），图保持上一版。可以把字改短，或者说「字小一点」再试');
    return false;
  }
  // 底图上的图表也是重新画的：图表没画上就不能交，否则交出去的图少了图表。
  const charted = candidate.program && candidate.program.chart;
  if (hasCharts(image) && (!charted || charted.status !== 'overlay')) {
    const why = charted ? chartFailText(charted) : '未知原因';
    image.textAttempt = { reasonText: '图表没画上：' + why };
    deps.emit(session, 'edit', image.id + ' 重新排字时图表没画上：' + why + '。图保持上一版', { level: 'warn', durMs: Date.now() - startedAt });
    session.questions.push(image.id + ' 重新排字时图表没画上（' + why + '），图保持上一版');
    return false;
  }
  candidate.verdict = carryProgramVerdict(base.verdict, image, candidate);
  const previous = image.status;
  image.roundBase = roundBase;
  image.rounds = [
    {
      index: 0,
      action: { type: 'text', prompt: '', parentId: base.id || null, refs: [], overlay: true },
      candidates: [candidate],
      verdict: { note: '在不带字的底图上重新排字' },
      startedAt,
    },
  ];
  image.chosen = candidate;
  image.status = candidate.verdict
    ? candidate.verdict.hardTotal > 0 && !candidate.verdict.hardFailed.length
      ? 'passed'
      : 'unpassed'
    : previous === 'passed'
      ? 'passed'
      : 'unpassed';
  image.chosenReason = '在不带字的底图上按新的要求重新排字，没有重新生图';
  deps.emit(session, 'edit', image.id + ' 文字已在原图上重新排好', { durMs: Date.now() - startedAt });
  return true;
}

// 只改图表：在不带图表的底图上按新的数据重画（排过的字、贴过的码照样再来一遍），不重新生图。
// 返回 'done'（画好了）、'needs_panel'（底图上那块地方不空，得让模型先留出面板）或 'failed'（图保持上一版）。
async function replaceChartInPlace(session, image, deps) {
  const base = image.chosen || lastCandidate(image) || lastDelivered(session, image, deps);
  // 原来有程序画上去的东西（图表、排的字）时底图在 basePath；没有的话交付的那张本身就是干净的底图。
  const basePath = base && (base.basePath || base.path);
  if (!basePath) {
    deps.emit(session, 'edit', image.id + ' 找不到上一版的底图，没法直接改图表', { level: 'warn' });
    session.questions.push(image.id + ' 找不到上一版的底图，这次没有改图表。可以回复「重画」重新生成这张图');
    return 'failed';
  }
  const startedAt = Date.now();
  deps.emit(session, 'edit', image.id + ' 只改图表：在不带图表的底图上按新的数据重画，不重新生图');
  let buffer;
  try {
    buffer = await readFile(basePath);
  } catch (error) {
    const why = '读不到上一版的底图：' + describeError(error);
    deps.emit(session, 'edit', image.id + ' ' + why, { level: 'error' });
    session.questions.push(image.id + ' ' + why + '，这次没有改图表');
    return 'failed';
  }
  const roundBase = (image.roundBase || 0) + (image.rounds || []).length;
  const candidate = {
    id: image.id + '-r' + (roundBase + 1) + '-g0',
    path: basePath,
    file: basePath.split(/[\\/]/).pop(),
    size: base.size,
    requestId: base.requestId,
    revisedPrompt: base.revisedPrompt,
    parentId: base.id || null,
    parentPath: basePath,
    parentStats: (base.program && base.program.stats) || null,
    actionType: 'chart',
    actionPrompt: base.actionPrompt || promptFor(image),
    round: 0,
    createdAt: Date.now(),
    buffer,
    program: {},
    checks: [],
  };
  await programChecks(session, image, candidate, deps);
  const charted = candidate.program && candidate.program.chart;
  if (hasCharts(image) && (!charted || charted.status !== 'overlay')) {
    const why = charted ? chartFailText(charted) : (candidate.program && candidate.program.error) || '未知原因';
    const blank = Boolean(charted) && (charted.items || []).some((item) => ['not_blank', 'marks'].includes(item.reason));
    deps.emit(session, 'edit', image.id + ' 图表没画上：' + why + (blank ? '' : '。图保持上一版'), { level: 'warn', durMs: Date.now() - startedAt });
    if (blank) return 'needs_panel';
    session.questions.push(image.id + ' 按新的要求画不下这张图表（' + why + '），图保持上一版。可以把图表放大一点，或者少几个类目再试');
    return 'failed';
  }
  const typed = candidate.program && candidate.program.text;
  if (isOverlay(image) && (!typed || typed.status !== 'overlay')) {
    const why = typed ? textFailText(typed) : '未知原因';
    deps.emit(session, 'edit', image.id + ' 重画图表时字没排上：' + why + '。图保持上一版', { level: 'warn', durMs: Date.now() - startedAt });
    session.questions.push(image.id + ' 重画图表时字没排上（' + why + '），图保持上一版');
    return 'failed';
  }
  candidate.verdict = carryProgramVerdict(base.verdict, image, candidate);
  const previous = image.status;
  image.roundBase = roundBase;
  image.rounds = [
    {
      index: 0,
      action: { type: 'chart', prompt: '', parentId: base.id || null, refs: [], overlay: isOverlay(image) },
      candidates: [candidate],
      verdict: { note: '在不带图表的底图上按新的数据重画图表' },
      startedAt,
    },
  ];
  image.chosen = candidate;
  image.status = candidate.verdict
    ? candidate.verdict.hardTotal > 0 && !candidate.verdict.hardFailed.length
      ? 'passed'
      : 'unpassed'
    : previous === 'passed'
      ? 'passed'
      : 'unpassed';
  image.chosenReason = hasCharts(image) ? '在不带图表的底图上按新的数据重画图表，没有重新生图' : '去掉了程序画的图表，没有重新生图';
  deps.emit(session, 'edit', image.id + (hasCharts(image) ? ' 图表已按新的数据重画好' : ' 图表已去掉'), { durMs: Date.now() - startedAt });
  return 'done';
}

// 编辑节点写的图表改动并进规格：{index, 要改的字段} 改已有的那张，{index, remove:true} 删掉，不写 index 是新加一张。
function applyChartPatches(session, image, patches, instruction, deps) {
  const charts = imageCharts(image).slice();
  const changes = [];
  const problems = [];
  for (const patch of patches) {
    if (!patch || typeof patch !== 'object') continue;
    const rawIndex = patch.index;
    const index = rawIndex === undefined || rawIndex === null || rawIndex === '' ? null : Number(rawIndex);
    if (index !== null) {
      if (!Number.isInteger(index) || index < 0 || index >= charts.length || !charts[index]) {
        problems.push('没有第 ' + (Number.isFinite(index) ? index + 1 : rawIndex) + ' 张图表');
        continue;
      }
      if (patch.remove === true) {
        charts[index] = null;
        changes.push('去掉第 ' + (index + 1) + ' 张图表');
        continue;
      }
      // 小数位按新数据重算（不带上一版算出来的）；规划写的下限值 yMin 让给补丁里的 y_min。
      const previous = { ...charts[index] };
      delete previous.check;
      delete previous.decimals;
      const update = {};
      for (const key of CHART_PATCH_FIELDS) if (patch[key] !== undefined) update[key] = patch[key];
      if ('y_min' in update) delete previous.yMin;
      if ('y_max' in update) delete previous.yMax;
      const { chart, problem } = normalizeChart({ ...previous, ...update });
      if (!chart) {
        problems.push('第 ' + (index + 1) + ' 张：' + problem);
        continue;
      }
      charts[index] = chart;
      changes.push('改第 ' + (index + 1) + ' 张图表');
      continue;
    }
    if (patch.remove === true) continue;
    if (charts.filter(Boolean).length >= MAX_CHARTS) {
      problems.push('一张图最多放 ' + MAX_CHARTS + ' 张图表');
      continue;
    }
    const { chart, problem } = normalizeChart(patch);
    if (!chart) {
      problems.push('新加的图表：' + problem);
      continue;
    }
    charts.push(chart);
    changes.push('加一张' + (CHART_TYPES[chart.type] || '图表'));
  }
  image.spec.charts = chartsWithCheck(charts.filter(Boolean), qrSources(session, [instruction]));
  image.spec.checklist = chartChecklist(image.spec.checklist, image.spec.charts);
  if (changes.length) deps.emit(session, 'edit', image.id + ' 调整图表：' + changes.join('，'));
  for (const problem of problems) deps.emit(session, 'edit', image.id + ' 这处图表改动没法做：' + problem, { level: 'warn' });
  const unverified = image.spec.charts.filter((chart) => chart.check && !chart.check.ok);
  if (unverified.length) {
    deps.emit(session, 'edit', image.id + ' 的图表里有数在你说过的话里找不到：' + unverified.map((chart) => chart.check.missing.join('、')).join('；') + '，照画，交付时请核对', { level: 'warn' });
  }
}

// 底图上预留给图表的地方不空时，给模型的编辑指令：只在那里腾出一块空白面板，别的都不动。
function chartPanelPrompt(image) {
  const parts = imageCharts(image).map((chart) => describeBox(chart.box || CHART_DEFAULT_BOX) + '留出一块' + (chart.surface || '平整的浅色面板'));
  return '在' + parts.join('，在') + '：这块地方完全空白、平整干净，原来在那里的东西挪开或去掉；画面其他地方保持不变。';
}

// ---------------------------------------------------------------- 01/02/03 规划

// ---------------------------------------------------------------- 规划核对：按版面读出来的文字
//
// 程序排字只核对每一层的字排上了。规划要是把「清」拆成「氵」「青」两层并排摆，每一层都「排对了」，
// 版面上却没有「清」（真机 20261117-f57a0f，评审还判了通过）。所以规划完先把文字层按位置从上到下、
// 从左到右读一遍，和用户原话里引号中的文字对照。只查「字都在、却读不出来」的那种：引号里的字
// 有的根本不在文字层里，多半是用户在描述别的东西（「像“清明上河图”那样」），不是要排的字。
const QUOTE_RE = /[“"「『]([^”"」』\n]{1,60})[”"」』]/g;
const HAN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;

// 读的时候不管空格和全角半角：「＋　青　＝」和「+ 青 =」是同一串。
function readingText(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, '');
}

function quotedTexts(instruction) {
  const out = [];
  for (const match of String(instruction || '').matchAll(QUOTE_RE)) {
    const value = readingText(match[1]);
    if (Array.from(value).length >= 2 && HAN.test(value) && !out.includes(value)) out.push(value);
  }
  return out;
}

// 文字层按版面读出来的几行：中心落在同一条横带里的算一行，行内从左到右。有竖排的层就只按层读。
function readingRows(layers) {
  const items = (layers || []).filter((layer) => layer && layer.text && Array.isArray(layer.box) && layer.box.length === 4);
  if (items.some((layer) => layer.direction === 'vertical')) return items.map((layer) => readingText(layer.text));
  const rows = [];
  for (const layer of items.slice().sort((a, b) => a.box[1] + a.box[3] - (b.box[1] + b.box[3]))) {
    const center = (layer.box[1] + layer.box[3]) / 2;
    const row = rows.find((item) => center >= item.y0 && center <= item.y1);
    if (row) {
      row.items.push(layer);
      row.y0 = Math.min(row.y0, layer.box[1]);
      row.y1 = Math.max(row.y1, layer.box[3]);
    } else {
      rows.push({ y0: layer.box[1], y1: layer.box[3], items: [layer] });
    }
  }
  return rows.map((row) => row.items.sort((a, b) => a.box[0] - b.box[0]).map((layer) => readingText(layer.text)).join(''));
}

function readingProblems(session, images) {
  const quotes = quotedTexts(session.instruction);
  if (!quotes.length) return [];
  const out = [];
  for (const image of images || []) {
    const layers = (image.spec && image.spec.textOverlay && image.spec.textOverlay.layers) || [];
    if (layers.length < 2) continue;
    const rows = readingRows(layers);
    const all = rows.join('');
    const present = new Set(Array.from(all));
    for (const quote of quotes) {
      const glyphs = Array.from(quote).filter((ch) => HAN.test(ch));
      if (!glyphs.every((ch) => present.has(ch))) continue;
      if (all.includes(quote)) continue;
      out.push({ imageId: image.id, quote, rows });
    }
  }
  return out;
}

function readingDetail(problems) {
  return [
    list('读不出来的', problems.map((item) => ({ tag: 'fail', text: item.imageId + '：「' + item.quote + '」' }))),
    text('按版面读出来是', [...new Set(problems.map((item) => item.imageId))].map((id) => id + '：' + problems.find((item) => item.imageId === id).rows.join(' / ')).join('\n')),
  ];
}

function readingFeedback(problems, data) {
  const ids = [...new Set(problems.map((item) => item.imageId))];
  return [
    '程序核对（必须改正）：你上一次输出的文字层，按版面位置从上到下、从左到右读出来是：',
    ...ids.map((id) => '- 图 ' + id + '：' + problems.find((item) => item.imageId === id).rows.map((row) => '「' + row + '」').join(' ')),
    '用户原话里要排出来的这几处读不出来：' + problems.map((item) => '「' + item.quote + '」').join('、') + '。',
    '常见原因：把一个字拆成了偏旁和部件两层并排摆（一个字要两种颜色时写成完整的字，用 part，见 4d）；',
    '几层的位置排错了行或左右颠倒；漏了某一层。改正文字层后重新输出完整的 JSON，别的部分可以照抄上一次的输出。',
    '上一次的输出：',
    JSON.stringify(data),
  ].join('\n');
}

// 本机各书体实际用哪个字体，一句话写给规划：「kai → 本机没有楷体，用马善政毛笔楷书代替」。
async function fontFactsLine() {
  let kinds = [];
  try {
    kinds = await describeFontKinds();
  } catch {
    return '没查到';
  }
  const parts = kinds.map((item) => {
    if (!item.used) return item.kind + ' → 本机没有' + item.label + '字体';
    if (item.used === item.kind) return item.kind + ' → ' + item.name;
    return item.kind + ' → 本机没有' + item.label + '字体，用' + item.name + '（' + FONT_KINDS[item.used].label + '）代替';
  });
  const kai = kinds.find((item) => item.kind === 'kai');
  const tail = kai && kai.used && kai.used !== 'kai' && FONT_KINDS[kai.used].handwriting
    ? '。本机的 kai 是毛笔字，识字挂图、课本、试卷这类要标准字形的版面用 song 或 hei'
    : '';
  return parts.join('；') + tail;
}

// 时间线上的难度：「难（规划判的：15 段排版文字）」「一般（按规格推断）」。
function difficultyText(image) {
  const level = difficultyOf(image);
  return DIFFICULTY_LABELS[level.level] + '（' + (level.source === 'plan' ? '规划判的' : '按规格推断') + (level.reason ? '：' + level.reason : '') + '）';
}

async function planNode(session, deps) {
  const startedAt = Date.now();
  // 规划还没判难度，它要做的只有打开你给的参考图：按张数给（24 次真机规划里 18 次一次工具都没用）。
  const budget = toolBudget('plan', { needs: [{ count: session.refs.length, what: '打开你给的参考图' }] });
  const fontFacts = await fontFactsLine();
  deps.emit(session, 'plan', '规划中：分诊欠定项、决定要不要检索参考图、给每张图出规格', {
    detail: detail('规划节点 · 输入', [
      text('用户原话', session.instruction),
      kv('已登记参考图', session.refs.length ? session.refs.map((ref) => ref.id).join('、') : '无'),
      kv('工具调用预算', budget.limit + ' 次（' + budget.note + '，运行时硬中断）'),
    ]),
  });
  const refs = session.refs
    .map((ref) => ref.id + ' -> ' + ref.path + (ref.note ? '（' + ref.note + '）' : ''))
    .join('\n');
  const instruction = [
    '你是H3-Image-Executor 的规划节点。用户只给了一句自然语言需求，你要产出一份可执行的图片计划。',
    '',
    '用户原话：',
    session.instruction,
    '',
    '已登记的参考图（本地绝对路径，需要判断"长什么样"时用 read 工具打开看）：',
    refs || '（无）',
    '',
    ...(session.answered || []).length
      ? [
          '',
          '已经问过用户并得到回答（直接按回答执行，不要再问同一件事）：',
          ...session.answered.map((item) => '- ' + item.question + ' → ' + item.answer),
        ]
      : [],
    '要求：',
    '1. 欠定项默认全部自己定，不要甩给用户。构图、光位、景别、镜头、风格、配色、材质、人物姿态与座位、',
    '   车内还是车外、白天还是夜晚、穿什么、要不要笑——用户没说就是让你决定，你选一个最合理的方案，',
    '   写进 assumptions（每条写"我定了什么"），然后照这个方案出图。',
    '2. questions 只允许放"选错整张图就白做"的问题，而且必须同时满足三条：',
    '   (a) 用户原话里这件事有两种以上都说得通的解读；(b) 选错会让整张图作废，而不是"不够好"；(c) 你没有任何依据判断哪个对。',
    '   最多 2 条，通常应该是 0 条。每条形如 {"text":"问题","options":["选项一","选项二"],"default":"选项一"}，',
    '   options 给 2-4 个互斥的具体选项，default 写你倾向的那个（用户不答就按它走）。',
    '2. 参考图：要不要检索、搜几项、肯花多少检索次数，由你按这次需求判断，不是每次都要搜。',
    '   不要自己调工具检索——把检索意图写进顶层 ref_queries，系统会替你调搜图工具、下载、筛选并编号。',
    '   这是硬性分工：你只负责说清“要搜什么”，检索、下载、编号全部由运行时执行。',
    '   建议先检索的情况：需求里出现专有名词或特定称谓，而上面没有对应的参考图。包括：',
    '   - 真人、角色或吉祥物、品牌和具体产品、logo、车型、地标、具体的建筑、文物或艺术品——这类东西长什么样是定死的，凭记忆画很容易画错；',
    '   - 用户点名一部真实存在的作品（电影、剧集、动画、游戏、小说）当主题，要做它的海报、同人图时：它的官方海报或剧照，',
    '     参考主角的经典造型和服装、标志性道具、配色和片名字体（query 写「作品名 官方海报」）；',
    '     人物的脸照原创画，不照搬演员（用户点名要像某位演员时除外），slots 里写清只参考造型、道具、配色和版式；',
    '   - 你不确定长什么样的冷门叫法：小众品种、地方特产、特定流派或工艺的名字。',
    '   可以搜也可以不搜的：通用的东西（猫、咖啡杯、海边、写字楼）、常见的画风和版面类型（水彩、扁平插画、课本内页、菜单）。',
    '   你有把握画对就不搜；觉得参考一张真实样例能明显画得更准（版式、材质、某种工艺的质感）再搜。纯想象、现实里没有对应物的画面不搜。',
    '   ref_budget：这次检索最多花多少次调用（整数 0-' + DEFAULTS.refBudgetMax + '）。搜图一次算 1 次，判定一批候选（3 张）算 1 次；',
    '   一项顺利时 2 次（搜 1 + 判 1），第一批都不对、换个说法重搜要 4–6 次。按每项有多要紧给：专有名词的主体给足（每项 4–6 次），',
    '   顺手参考的画风、版式每项 2 次就够。不搜写 0（ref_queries 写空数组）。不写时系统按每项 2 次、至少 ' + DEFAULTS.refBudgetDefault + ' 次给。',
    '   预算按 ref_queries 的顺序花，花完后面的项就不搜了：最要紧的写在前面。最多 6 项。',
    '   ref_queries 每项形如 {"task_name":"tokyo_tower","query":"东京塔 官方照片","alt_query":"Tokyo Tower","use":"subject","take":"塔身的结构和红白配色","prompt":"必须是东京塔本体，要能看清整座塔的外形"}：',
    '   - task_name：英文小写短名，本次规划内唯一；图片的 refs 就用这个名字引用检索结果。',
    '   - query：东西的正式名称 + 一个用途词（官方图 / 照片 / 正面照 / 车标 / logo / 实拍 / 样例 / 扫描）。',
    '     不要堆「立体摆件 手办 树脂公仔」这类泛词：泛词会把结果带到无关的商品上，实体名反而被淹没。',
    '   - alt_query：同一个东西换一种说法，写它在原产地语言或英文里的正式名称（例：ミャクミャク 公式、Myaku-Myaku official）。',
    '     第一批候选都不合格时系统会用它重搜。没有别的叫法就写一个同义说法。',
    '   - use：这张参考图拿来做什么。subject（主体外观，照着它画这个东西）/ detail（局部：道具、服饰、材质）/',
    '     style（画风：笔触、质感、配色）/ layout（版式：排版、留白、各元素的位置）/ scene（环境、场所）。',
    '     筛选按用途判：style / layout / scene 只要是这一类的真实样例就能用，不要求是某一个具体的东西。',
    '   - take：一句话写从它身上取什么（例：只取版式：课题、正文、插图和页码的位置），生成时会原样告诉模型。',
    '     底图要留白给程序排字、画图表的图，layout 参考图不会送进生图（上面全是字，会诱导模型在留白处写字）。',
    '   - prompt：筛选要求，只写「必须是哪个东西（或哪一类东西的真实样例）」和最多一条用途（例：要能看清全身外形）。',
    '     不要写颜色、五官、肢体数量、花纹这类外观细节：你可能记错，筛选节点会照着错的描述把真图否掉。',
    '     不要写互相冲突、实际拍不到的条件（例：既要看到完整的环形全貌、又要看清构件细节、还不要航拍）。',
    '   - 同一个东西只写一项：不要把「官方形象」「手办」「雕像」拆成几项，官方插画、实物雕像、手办照片都能当参考图。',
    '     只有确实需要两种完全不同的图（例：整体外观 + 材质细节特写）时才拆，拆开的两项要求不能重叠。',
    '   - 上面已经登记成 R1、R2… 的不要重复写；用户给了图的东西就用用户的图，不另搜。',
    '3. 图片的 refs 只写三种值：已登记的 R 编号、ref_queries 里的 task_name、用户原话里给出的图片地址（http/https）。',
    '   不要凭记忆写网址：原话里没有的地址系统不会用。三种都会归一成 R 编号并下载到本地；写别的字符串会被忽略并告警。',
    '4. 为每张要交付的图给出：id（大写字母，如 A、B）、slug、title、entry（t2i 或 edit）、aspect_ratio（如 "16:9"，拿不准用 "auto"）、slots、refs（引用 R 编号 / task_name / 图片地址）、text_layers（画面里必须出现的文字，没有就空数组）、text_overlay（有文字时写，见 4d）、qr_codes（画面里要放的二维码，没有就空数组，见 4c）、animation（要做动图 / GIF 时写，见 4e，不是动图写 null）、motion_gif（绕一个中心转的动画写，见 4e，不要就写 null）、panel_gif（分格组图要拼成 GIF 时写，见 4e，不要就写 null）、charts（画面里要有带数据的图表时写，见 4f，没有就空数组）、difficulty 和 difficulty_reason（见 4g）、checklist。',
    '4b. slug 是这张图的英文短名，直接当交付文件名用：全小写、单词之间用短横线、2-4 个词、只概括画面内容（主体 + 场景或动作），',
    '    例：orange-cat-on-windowsill、girl-and-cat-sleeping、shiba-under-tokyo-tower。不要写尺寸、风格、镜头语言，不要重复 id。',
    '    同一批图里 slug 必须互不相同——重名会导致交付文件互相覆盖。',
    '4c. 二维码：生图模型画不出能扫的码，码由系统生成真码、贴回画面、扫码验证，你只负责记下码里放什么。',
    '    需求里要求画面出现二维码（名片、海报、菜单、门牌上的码）时，每枚码写一项 {"content":"…","where":"名片下半部分居中"}：',
    '    - content 从用户原话里逐字复制（链接、文字、号码），一个字符都不要改：不要补全、不要缩写、不要翻译、不要换成你觉得对的网址。',
    '      例：用户说「二维码链接至（[https://www.minimax.cn/]）」，content 写 "https://www.minimax.cn/"。',
    '    - 用户要码却没说码里放什么，content 写空字符串 ""。不要自己编网址，也不要把它写进 questions：照常出图，交付时系统会注明是装饰码，',
    '      用户之后补一句内容就能直接在原图上换成真码。',
    '    - 多枚码按画面里从上到下、从左到右的顺序列出，最多 3 枚。',
    '    - 码能不能扫、扫出什么由系统实测（自动挂一条 H-qr），checklist 里不要写「二维码能扫」「链接正确」这类条目；',
    '      可以写「名片下半部分有一枚二维码」这种看得见的条目。slots 里只写码放在哪、多大，不要描述码的图案。',
    '4d. 图内文字的兜底：生图模型写长段文字、小字、竖排、书法时很容易写错、漏字、编字。系统有一条兜底链路：',
    '    先让模型画一张不带字的底图（纸面、招牌、屏幕、海报底板留空），再由程序用字体把文字按原文逐字排进去。',
    '    text_layers 不为空的图都要写 text_overlay（不管这一次用不用：模型把字画残了，系统会自动切到这条路）：',
    '    {"use":true,"base":{"subject":"…"},"layers":[{"text":"…","box":[0.06,0.16,0.94,0.84],"direction":"vertical","font":"brush","color":"#1a1a1a","align":"start","punctuation":"omit","surface":"宣纸纸面"}]}',
    '    - use：文字多（一段 20 字以上或合计 40 字以上）、要逐字准确的长文（诗词文章、书法作品、菜单、说明、价目表）、竖排、小字密排时写 true，',
    '      第一轮就走程序排字；短标题、几个字的招牌写 false，先让模型直接画。',
    '    - base：不带字的底图要改写的槽位，只写要改的那几个，没写的沿用 slots。凡是提到文字内容、书法作品、墨字笔画、「写着什么」的槽位都要改',
    '      （常见是 subject，有时还有 style、scene、light、negative），改成「载体留空」的说法：纸张、招牌、屏幕、海报底板这些载体照样画，载体上什么都不写。',
    '      例：subject 写「一幅完全展开、平铺的浅米色宣纸手卷，纸面完全空白，没有任何字迹、印章和界格线」，不要写「书法长卷」「写满了字」。',
    '      base 里不要出现文字内容本身。',
    '    - layers：text_layers 的每一项写一个，text 和 text_layers 里对应的那项逐字相同。',
    '      box：文字放在画面里的什么位置，[左, 上, 右, 下]，0-1 的画面比例；要落在 base 留空的载体上，离载体的边缘留出边距。',
    '      字号由系统按 box 自动取能排下的最大值：box 画多大，字就排多大，标题的 box 给扁一些，正文的 box 给大一些。',
    '      direction："horizontal" 横排 / "vertical" 竖排（从上到下、从右到左）。',
    '      font："brush" 毛笔楷书（清楚好认的毛笔字，楷书、行楷用它）/ "xing" 毛笔行书（更连贯，辨认度低一些）/ "kai" 楷体 / "song" 宋体 / "hei" 黑体。',
    '      本机实际用的字体：' + fontFacts + '。',
    '      color：十六进制颜色。align："start" / "center" / "end"（横排是左、中、右；竖排是每列从顶上写、居中、靠底）。',
    '      punctuation（竖排才写）：书法作品（古文、诗词、对联、手卷、条幅）写 "omit" 不写标点：古代书法本来不写标点，',
    '      「全文 324 字」这类字数也不算标点；用户明确要带标点的书法作品写 "side"（标点缩小写在字旁、不占格）；',
    '      菜单、说明、现代竖排海报写 "inline"（标点占一格）。',
    '      surface：文字写在什么上面，例：宣纸纸面、木招牌、海报底板、手机屏幕。',
    '      role：这一层在版面上是什么，title（标题）/ subtitle / body（正文）/ footnote（脚注）/ caption（图注）/ label / page（页码）/ pinyin（注音）。',
    '      同一种 role 的几层，程序统一成同一个字号（取其中最小的），所以一篇正文的几段都写 body、几条标签都写 label；',
    '      不要为了让字号不同而拆层，一个标题写成一层（「少年闰土①」），只有注在某个字上方的拼音单独一层（role 写 pinyin）。',
    '      版面像课本、书刊、说明书时：正文每段一层、role 写 body，程序自动首行空两格（不要缩进就写 "indent":0）；',
    '      脚注写成一层、role 写 footnote，程序会在它上方画一条短分隔线；正文、标题里的脚注符号（①②…）直接写在被注的字后面',
    '      （「猹(chá)②尽力」），程序把它排成右上角的小字，脚注层每条开头的序号保持正常大小。',
    '      最多 16 层。页码、角标这类短字别忘了也写成一层。',
    '      part：一个字里要有两种颜色时写（识字挂图：「清」的「氵」橙色、「青」深灰），{"side":"left","color":"#E8710A"}：',
    '      这一层每个汉字靠 side（left / right / top / bottom）那一侧的部件用 part.color，其余部分用这一层的 color。',
    '      程序在字形上找偏旁和其余部分之间的切线来分色；字体里切不开时会自动换宋体或黑体。',
    '      要出现的字一定写成完整的一个字：不要把「清」拆成「氵」「青」两层并排摆，也不要在整字上再叠一层偏旁：',
    '      拆开的是两个字，叠上去的偏旁和字里的偏旁位置、大小都对不上。独立的偏旁（「氵」「忄」「讠」）字形本来就窄小、',
    '      靠字身左边，要它看得清，就单独一层、role 不要和整字共用，box 按想要的大小给。',
    '      系统会把各层按位置从上到下、从左到右读一遍，和用户原话里引号中的文字对照，读不出来会退回来让你改。',
    '4e. 动图（GIF）：需求要的是动图、GIF、会动的表情包时，在这张图上写 animation。生图模型一次只出一张静态图，',
    '    系统先定一张参考图，第一帧从参考图改，后面每一帧在前一帧上接着改一小步（参考图一直作为对照），最后由程序拼成 GIF：',
    '    {"reference":"R1","frames":[{"same":true},{"prompt":"右手抬到脸旁边，掌心朝前"},{"prompt":"右手举过头顶，向外挥"},{"prompt":"右手抬到脸旁边，掌心朝前"}],"frame_ms":300,"loop":true,"edge":768,"transition":"fade"}',
    '    - reference：用户给了图、要拿这张图直接做动图，写它的 R 编号，系统不会再画这张图，slots 简单描述这张图的画面即可；',
    '      用户没给图，或者要先把他给的图改成别的样子（换画风、换场景）再动起来，写 "self"：这张图先按 slots 正常画出来当参考图，',
    '      交给用户确认之后再出各帧。',
    '    - frames：按播放顺序 4–16 帧。帧数按动作幅度定，不要每次都写 6 帧：目标是 GIF 看起来顺，相邻两帧只差一小步。',
    '      眨眼、挑眉、嘴型这类小动作 4–6 帧；点头、挥手、耸肩 6–10 帧；转头到另一边、手从画面外抬进来、起身这类大动作 10–16 帧。',
    '      一步里只让一两个部位动一点，几步的变化量差不多大：不要一步里同时转头、抬手、换表情，再接一步几乎不动。',
    '      帧多的时候 frame_ms 写短一点（120–200 毫秒），整组一般 1.5–3 秒。系统会量相邻两帧变了多少，一步跨得太大的地方',
    '      会自动补中间姿态，但规划时就拆细最好。',
    '      {"same":true} 表示这一帧就是参考图本身，通常第 1 帧是它；其余每帧的 prompt 写这一帧和参考图',
    '      相比所有不同的地方（姿势、表情、手的位置、头的角度），不要描述没变的主体和背景：系统会要求其余部分和参考图保持一致。',
    '      每一帧的 prompt 写这一帧的完整状态（模型按它把前一帧改到这个样子）：前面帧里做出的变化，后面的帧还要保持的，要在后面每一帧里再写一遍',
    '      （第 3 帧把伞向右倾斜罩住小猫，第 4 帧伞还斜着、小猫挪近，第 4 帧就写「伞仍向右倾斜约三十度罩住小猫，小猫挪近半步」）。',
    '      只写这一帧新加的动作，前面的变化可能被改回参考图的样子，播放时动作来回跳。',
    '      这是关键帧动画，不是视频：把动作拆成几个清楚的姿态（挥手：手在脸旁 → 举过头顶 → 回到脸旁），相邻两帧的变化小而明确。',
    '      循环播放时播完自动接回第 1 帧，末尾不要再放 {"same":true}；最后一帧到第 1 帧也是一次变化，跨度不要比中间的大，',
    '      要回到起手的姿态，就在末尾放一两帧逐步回去。只播一遍（loop 为 false）又要停在开头的姿态，才在末尾放 {"same":true}。',
    '      不要写镜头推拉、缩放、换背景这类每一帧画面都要整体变的动作。',
    '      两帧写一模一样的 prompt，系统只画一次、两帧用同一张图：来回往复的动作这样写，回到同一个姿态时画面才不抖。',
    '    - 参考图要先画的（reference 写 "self"），area 写 "2K"：GIF 最大 1024 像素，4K 只会更慢。',
    '    - frame_ms：每帧停多少毫秒，默认 300；某一帧要停久一点，在那一帧写 "hold_ms"。loop：默认 true，循环播放。',
    '      edge：GIF 长边多少像素，默认 768，最大 1024。',
    '    - transition：帧和帧之间怎么接。默认 "fade"，程序在相邻两帧之间补两帧渐变，动作更顺（两帧差得多时不补：叠出来是虚影）；',
    '      要一下一下跳的效果（像素风、定格动画、卡点、闪烁）写 "cut"，直接切换。',
    '    - checklist 照常写参考图本身要满足的条件；每一帧画得对不对由动图评审单独核对，不要写进 checklist。',
    '    - 组图拼 GIF：用户要的是一张分格的组图（四格、六格、九宫格的表情变化、分步、前后对比），同时要把它做成 GIF',
    '      （「做成动图」「再拼成 GIF」），不写 animation，在这张组图上写 panel_gif。组图照常生成、评审，通过后由程序切格、',
    '      按顺序拼成 GIF，组图和 GIF 一起交付：{"rows":2,"cols":3,"frame_ms":700,"loop":true}',
    '      rows / cols 是几行几列，和 slots 里写的排法一致。slots 里写清：格与格之间用细分隔线或留白隔开，主体在每一格里的位置和大小一样，',
    '      格子里不写序号（用户要的除外）：程序靠分隔线切格，主体位置一致，播起来才不会一跳一跳的。',
    '      frame_ms 每格停多少毫秒（默认 700，第一格停 1.5 倍、最后一格停 2 倍）；某一格要停久一点写 hold [{"index":6,"ms":2000}]；',
    '      order 播放顺序（格子编号从上到下、从左到右数，默认按编号）；pingpong 写 true 来回播；loop 默认 true；',
    '      transition 默认 "cut"，直接切换；"fade" 两格之间渐变（两格差得多时叠出来是虚影，少用）。',
    '      组图评审通过后，系统会在相邻两格之间各补一格中间状态（在原组图上改一次、一起生成，从候选里挑），GIF 一步一步地动；',
    '      要多一次生图、一两分钟。格与格之间换了场景、换了人物或机位（四格漫画讲故事）写 "smooth":false，不补。',
    '      动作要连贯顺滑（挥手、眨眼、转身）用 animation，不要用 panel_gif：组图的格子之间是一下一下切换的。',
    '    - 绕一个中心转的动画（加载圈、转圈的图标、旋转的齿轮 / 风车 / 唱片 / 罗盘、亮点沿圆环一格一格跑），不写 animation，',
    '      写 motion_gif：模型只画一张图，程序按圆心把画面转出各帧，每一帧都准、首尾接得上。一帧一帧让模型改画不准',
    '      亮点在第几格，改错的帧扔掉以后亮点一下跳一格、一下跳三格。',
    '      {"type":"spin","center":[0.5,0.5],"radius":0.32,"steps":12,"direction":"cw","frame_ms":80,"edge":512}',
    '      center 是转动中心在画面里的位置（宽、高的比例），radius 是要转的那一块的半径（画面短边的比例），要盖住整个转动的东西；',
    '      steps 写圆环上等距的点、辐条或格子数（亮点一格一格跑），整个东西连续转写 0；direction 是 cw 顺时针 / ccw 逆时针；',
    '      frame_ms 一格停多少毫秒（一格一格跳的 60–120，连续转的 40–60）；edge 是 GIF 长边，用户说了尺寸就照写。',
    '      slots 写的是一张静态图：转动的东西正好在 center、等距的点或辐条间距完全一样；radius 那一圈里面的背景是纯色、',
    '      或者从 center 向外的渐变，不放别的东西（转的时候背景跟着转，有图案就看得出来），圆圈外面的东西不动；',
    '      亮点一格一格跑的，只画一个时刻：亮点在 12 点钟，尾巴画在亮点转过来的那一侧（顺时针转时尾巴在它的逆时针一侧）。',
    '4f. 数据图表：画面里要有柱状图、条形图、折线图、面积图、饼图、环形图这类带数据的图表时，在这张图上写 charts。',
    '    生图模型画不准柱子高矮、刻度和数字，图表由程序按数据画进底图上留空的面板，画完从最终文件量回来核对：',
    '    [{"type":"bar","title":"2020–2025 年销售额","unit":"万元","categories":["2020","2021","2022"],"series":[{"name":"销售额","values":[120,150,180]}],"box":[0.08,0.3,0.92,0.92],"surface":"白色卡片"}]',
    '    - type：bar 柱状图（比较各项、按时间的少量数）、hbar 条形图（排名、类目名字长）、line 折线图（趋势、点多）、area 面积图、',
    '      pie 饼图 / donut 环形图（各部分占整体，各项加起来就是整体）。多个系列的柱状图、条形图可以写 "stacked":true 堆叠。',
    '    - 数据只抄用户给的：categories 和 values 从用户原话里逐个照抄，顺序一致，一个数都不要改、不要补、不要编；',
    '      比例、合计、增长率由程序算，不要自己算好写进去。用户没给具体的数，而图表是这张图的重点时，在 questions 里问他要数；',
    '      图表只是背景装饰（科技感海报背景里的上涨曲线）就不写 charts，在 negative 里写「不要画带数字和刻度的图表」。',
    '    - values 写数字，不带单位；单位写进 unit（"万元"、"%"、"人次"）。百分比写 25 不写 0.25，unit 写 "%"。',
    '      折线图的数离 0 很远（体重 60–70 kg）可以写 y_min（例如 60），刻度从它开始；柱状图、条形图一律从 0 起，不写 y_min。',
    '    - box：图表在画面里的位置 [左,上,右,下]（0-1 的画面比例）；surface：图表画在什么上面（白色卡片、黑板、纸面、屏幕）。',
    '      图表要占够地方：短边不小于画面的 35%，类目多、系列多就更大。slots 里把这块写成留空的平整面板',
    '      （「右侧一块空白的白色卡片」），不要描述图表本身；系统会要求模型把这块留空。',
    '    - title 可写可不写，写了就不要再在 text_layers 里写同一个标题。colors 可以给每个系列（饼图给每一块）配和画面协调的颜色（十六进制）。',
    '    - checklist 不要写「柱子高度和数值一致」这类条目，程序会核对。',
    '4g. difficulty：这张图难不难验、难不难改，写 "easy" / "normal" / "hard"，difficulty_reason 用一句话写为什么（不超过 30 字）。',
    '    它决定后面评审、修正、选优、追问编辑这些节点每次能调用几次工具（打开看图材料、放大看细节、核对参考图）：',
    '    系统按「必须打开的图 + 难度给的余量」现算，难的图多给。判断标准：',
    '    - hard：要逐字核对的大段文字或多段排版（课本页、菜单、长卷）、要和参考图对上的真人或产品、多个主体之间的一致性、',
    '      精确的数量和手势姿态、8 帧以上的动图、几张图表，或者硬性条目很多（6 条以上）；',
    '    - easy：单一主体、没有参考图和文字、要求一眼就能看清（一只猫、一杯咖啡）；',
    '    - 其余写 normal。拿不准就写 normal。',
    '5. 不要自己写整段 prompt，改为填 slots —— 系统会按固定顺序拼成送进模型的长描述。槽位含义：',
    '   style       整体风格与调色。例：高端汽车广告级写实摄影，暖中性色调，真实皮肤纹理',
    '   shot        景别。例：车内广角中近景 / 半身特写 / 全景',
    '   composition 机位与构图关系。例：从第二排右侧略低机位向前拍，两人形成左前到右后的对角线',
    '   scene       环境与背景。例：一辆白色 MPV 行驶在城市高架上，窗外是被速度虚化的城市',
    '   subject     主体，逐个人/物写清外貌、衣着、姿态、动作与相互关系。这是最长的一段，写细',
    '   material    材质与细节。例：浅米白 Nappa 真皮带细密缝线与打孔，浅色木纹饰板（没有可留空）',
    '   light       光线方向、性质与补光。例：午后侧逆光从天幕斜射，浅色内饰自然补光，面部清晰眼神有光',
    '   lens        焦段、光圈、景深与动态模糊。例：24mm 等效广角、f/2.8，两人均在焦内',
    '   text        图内必须出现的文字，没有就留空字符串',
    '   negative    排除项。例：不要文字、不要水印、不要多余的人',
    '   style/shot/composition/scene/subject/light/lens 是必填，缺一个系统会用兜底值并告警；material 可留空。',
    '   每个槽位写具体可执行的描述，不要写"合适的光线""精美的构图"这种空话。',
    '5b. 色彩是硬要求：style 槽位必须写清白平衡（例：中性白平衡、真实色彩还原，不要暖黄调）；用户要的就是以黄、红、橙为主色的画面时',
    '   不写「不要暖黄调」，写成「主色来自物体和背景本身的颜色，不是暖色滤镜；白、灰、黑这些中性的地方保持中性」；',
    '   negative 槽位必须包含"整体偏红、偏暖发黄"（用户要的就是以黄、红、橙为主色的画面时不写这条，写了也会被去掉）。系统还会再追加一条固定的白平衡要求，不要重复抄。',
    '5c. 要靠参考图锁定外观的实体（ref_queries 里写了的、或已登记成 R 编号的），subject 里写它的名字、在画面里的位置和大小、',
    '    材质或造型上要做的改动（例：做成树脂摆件），外观写「外观与参考图一致」。不要凭记忆补写它的颜色、五官、肢体数量和花纹：',
    '    记错了会直接画错，参考图到了还会和你写的打架。你非常确定的一两个标志性特征可以写。',
    '6. checklist 每项形如 {"id":"H1","kind":"hard","text":"...","verify":"vlm"}；hard 是必须满足的（主体与数量、图内文字、参考图一致性、用户点名要求），soft 是风格偏好。',
    '   hard 最多 4 条，而且只能来自用户原话里明确说过的东西——不要把自己想到的"最好也有"写成 hard。',
    '   每张图至少 1 条 hard。写不出 4 条就少写，不要凑数。',
    '   一条 hard 只写一个可判定条件，带多个限定词的必须拆开。评审是逐条核对的，复合条目会被"部分满足"蒙混过关：',
    '   反例「机位在车外左侧约45度，透过前挡风玻璃与驾驶位侧窗能清楚看到车内两人」——评审只核对了"车外"和"看到两人"就放行；',
    '   正例拆成两条「机位在车外左前方约45度，画面里能看到车头左前角与A柱」「透过前挡风玻璃与驾驶位侧窗能清楚看到车内两人」。',
    '   机位、角度、景别、构图这类必须各自单独成条，并写成"画面里能看到什么"这种可核对的事实，不要写成风格描述。',
    '   拆完超过 4 条时，把语义相邻的合并，但上面这类构图条目不要合并。',
    '   参考图一致性写成「画面里的 X 和参考图是同一个（认识的人一眼能认出）」，不要把它的外观细节拆成 hard 条目（理由同 5c）。',
    '6b. 姿势正确性：需求里出现手语/手势、瑜伽或健身体式、乐器指法、舞蹈或武术动作、',
    '    攀岩抓点、握笔握筷这类「必须摆成某个特定姿势」的内容时，每个姿势单独写一条 hard，',
    '    而且必须写成「姿势本身对不对」，不是「图上有没有对应的文字标签」。',
    '    反例（错）：「画面里出现文字「A」」——图上印着 A 就过，手型完全不对也照样放行；',
    '    正例（对）：「A 格里的手型确实是 ASL 字母 A：握拳、拇指贴在食指外侧，其余四指收拢」。',
    '    这类需求里文字标签是次要的：先保证姿势正确，标签只写进 text_layers，不要占用 hard 名额。',
    '    同一张图里姿势多于 4 个时，按组分条（例：「A-E 五格手型分别符合 ASL 对应字母」），',
    '    但仍然必须是 hard，不许降级成 soft。',
    '7. 默认 4K：除非用户明确要别的尺寸，area 一律写 "4K"。',
    '8. route：需求简单、只出 1 张图写 "fast"；多图或有参考图/文字/一致性要求、或画面里要放能扫的二维码写 "full"。',
    '8b. 主体一致性（多图专用）：images 达到 2 张，且同一个主体（人物 / 动物 / 拟人化物体）在 2 张以上的图里出现时，',
    '    必须输出 character_refs，为该主体单独出一张「角色设定图」，之后相关图全部以它为外观基准。',
    '    判据是"这个主体会不会被画成两个样子"：漫画分镜、绘本、系列海报、同一产品的多角度图要写；',
    '    四张不同风景、四个互不相干的产品不要写。',
    '    每项形如 {"key":"girl","note":"16 岁少女","prompt":"...","images":["A","B","D"]}；images 省略表示所有图都用它。',
    '    prompt 必须写成角色设定稿：纯净浅灰单色背景、主体全身正面居中站姿、柔和平光无强阴影、无文字无水印，',
    '    并把该主体的外观特征全部写死（脸型、发型与发色、眼睛、体型比例、服装款式与配色、标志性配件）。',
    '    最多 2 个主体。没有跨图重复主体时输出空数组 []。',
    '10. 规划阶段总工具调用上限 ' + budget.limit + ' 次，只用于 read 已登记的参考图。到达上限就用手上已有的信息出计划。',
    '',
    '只输出一个 JSON 对象，不要解释、不要 markdown 代码块：',
    '{"route":"full","think":["..."],"assumptions":["柴犬坐在长椅左侧，把右侧留给塔身，因为需求要同时看清狗和塔"],"questions":[],"character_refs":[{"key":"girl","note":"16 岁少女","prompt":"角色设定稿：纯净浅灰背景，全身正面居中站姿…","images":["A","B"]}],"ref_queries":[{"task_name":"tokyo_tower","query":"东京塔 官方照片","alt_query":"Tokyo Tower","use":"subject","take":"塔身的结构和红白配色","prompt":"必须是东京塔本体，要能看清整座塔的外形"}],"ref_budget":4,"images":[{"id":"A","slug":"shiba-under-tokyo-tower","title":"...","entry":"t2i","aspect_ratio":"16:9","area":"4K",',
    ' "slots":{"style":"...","shot":"...","composition":"...","scene":"...","subject":"...","material":"...","light":"...","lens":"...","text":"","negative":"..."},',
    ' "refs":[],"text_layers":[],"text_overlay":null,"qr_codes":[],"animation":null,"motion_gif":null,"panel_gif":null,"charts":[],"checklist":[{"id":"H1","kind":"hard","text":"...","verify":"vlm"}]}]}',
  ].join('\n');

  let { data } = await deps.agent.runJson(session, { step: 'plan', instruction, maxTools: budget.limit, budgetNote: budget.note });
  // 程序核对：文字层按版面读出来，用户引号里要排的字读不出来，就把具体问题交回规划改一次（见 readingProblems）。
  let images = normalizePlan(data, session);
  let reading = readingProblems(session, images);
  if (reading.length) {
    deps.emit(session, 'plan', '规划的文字按版面读出来和你的原话对不上，交回规划改一次：' + reading.map((item) => '「' + item.quote + '」').join(''), {
      level: 'warn',
      detail: detail('文字核对 · 第 1 次规划', readingDetail(reading)),
    });
    try {
      const retry = await deps.agent.runJson(session, {
        step: 'plan',
        instruction: instruction + '\n\n' + readingFeedback(reading, data),
        maxTools: budget.limit,
        budgetNote: budget.note,
      });
      const retryImages = normalizePlan(retry.data, session);
      const again = readingProblems(session, retryImages);
      if (retryImages.length && again.length <= reading.length) {
        data = retry.data;
        images = retryImages;
        reading = again;
      }
    } catch (error) {
      deps.emit(session, 'plan', '规划重写没跑成（' + describeError(error) + '），按第一次的规划走', { level: 'warn' });
    }
    if (reading.length) {
      deps.emit(session, 'plan', '改过之后还是读不出来：' + reading.map((item) => '「' + item.quote + '」').join('') + '，评审会按图核对这几处', {
        level: 'warn',
        detail: detail('文字核对 · 改过之后', readingDetail(reading)),
      });
    } else {
      deps.emit(session, 'plan', '规划改过之后，文字按版面读出来和你的原话对上了');
    }
  }
  session.plan = data;
  session.route = data.route === 'fast' ? 'fast' : 'full';
  const refQueries = normalizeRefQueries(data.ref_queries);
  const refQuerySummary = refQueries.length
    ? refQueries.map((item) => item.task_name + '：' + item.query).join('；')
    : '无（本轮不检索参考图）';
  session.think = Array.isArray(data.think) ? data.think : [];
  session.assumptions.push(...(Array.isArray(data.assumptions) ? data.assumptions : []).map((item) => String(item || '').trim()).filter(Boolean));
  session.blockers = normalizeBlockers(data.questions);
  session.images = images;
  for (const image of session.images) image.spec.readingProblems = reading.filter((item) => item.imageId === image.id);
  // 要贴真码的图走完整回路：快速路线每轮只出 1 张候选、最多重来 1 次，码没贴成就只能带着坏码交付。
  if (session.route === 'fast' && session.images.some((image) => qrContents(image.spec).length)) {
    session.route = 'full';
  }
  // 文字容易写残的图（字多、竖排、书法，或者规划自己判断）一开始就让模型画无字底图、程序排字。
  // 其余有文字的图先让模型直接画，评审判出文字画残了再切过来（见 runImage）。
  for (const image of session.images) {
    const overlay = image.spec.textOverlay;
    if (!overlay || !overlay.layers.length) continue;
    const risk = textRisk(overlay.layers);
    if (!overlay.use && !risk.high) continue;
    // 规划说要走程序排字、却没写排在哪的短字：按默认位置排会在画面正中压一大块字，先让模型直接画。
    if (!canPlaceText(image)) continue;
    const why = risk.high ? '文字' + risk.reasons.join('、') + '，模型直接写很容易写残' : '规划判断这段文字模型直接写容易写残';
    enterOverlay(session, image, why);
    if ((overlay.dropped || []).length) {
      deps.emit(session, 'plan', image.id + ' 的文字超过 ' + MAX_TEXT_LAYERS + ' 段，后面 ' + overlay.dropped.length + ' 段排不进去：' + overlay.dropped.map((value) => '「' + shortText(value, 12) + '」').join(''), { level: 'warn' });
    }
    deps.emit(session, 'plan', image.id + ' ' + why + '：先画不带字的底图，文字由程序按原文排进去', {
      detail: detail('程序排字 · ' + image.id, [
        kv('原因', why),
        ...overlay.layers.map((layer, index) =>
          group('第 ' + (index + 1) + ' 段文字', [
            kv('内容', shortText(layer.text, 40)),
            kv('位置', describeBox(layer.box) + (layer.surface ? '（' + layer.surface + '）' : '')),
            kv('排法', (layer.direction === 'vertical' ? '竖排' : '横排') + ' · ' + FONT_KINDS[layer.font].label + (layer.color ? ' · ' + layer.color : '')),
          ]),
        ),
        text('不带字的底图 prompt（送进模型）', image.spec.basePrompt),
      ]),
    });
  }
  // 程序排字要靠重画来换一张留好空白的底图，快速路线只有一次重来的机会，不够用。
  if (session.route === 'fast' && session.images.some((image) => isOverlay(image))) {
    session.route = 'full';
  }
  for (const image of session.images) {
    for (const problem of image.chartProblems || []) deps.emit(session, 'plan', image.id + ' 有一张图表写得不完整，没画：' + problem, { level: 'warn' });
    delete image.chartProblems;
    const charts = imageCharts(image);
    if (!charts.length) continue;
    deps.emit(session, 'plan', image.id + ' 里的 ' + charts.length + ' 张图表由程序按数据画：先画留出空白面板的底图，图表画上去之后从最终文件量回来核对', {
      detail: detail('数据图表 · ' + image.id, [
        ...charts.map((chart, index) =>
          group('第 ' + (index + 1) + ' 张', [
            kv('图表', describeChart(chart)),
            kv('位置', describeBox(chart.box || CHART_DEFAULT_BOX) + (chart.surface ? '（' + chart.surface + '）' : '')),
            chart.check && !chart.check.ok ? kv('数据核对', '这些数在用户原话里找不到：' + chart.check.missing.join('、')) : kv('数据核对', '每个数都能在用户原话里找到'),
          ]),
        ),
      ]),
    });
    const unverified = charts.filter((chart) => chart.check && !chart.check.ok);
    if (unverified.length) {
      deps.emit(session, 'plan', image.id + ' 的图表里有数在用户原话里找不到：' + unverified.map((chart) => chart.check.missing.join('、')).join('；') + '，照画，交付时请用户核对', { level: 'warn' });
    }
  }
  // 面板没留空要靠重画来换底图，和程序排字一样走完整回路。
  if (session.route === 'fast' && session.images.some((image) => hasCharts(image))) {
    session.route = 'full';
  }
  for (const image of session.images) {
    const unverified = (image.spec.qrCodes || []).filter((item) => item.content && !item.verbatim);
    if (!unverified.length) continue;
    deps.emit(
      session,
      'plan',
      image.id + ' 的二维码内容在用户原话里找不到，不贴真码：' + unverified.map((item) => '「' + item.content + '」').join('、'),
      { level: 'warn' },
    );
  }
  for (const image of session.images) {
    if (!image.spec.missingSlots || !image.spec.missingSlots.length) continue;
    // 拿用户给的图直接做动图：这张图不会再画，槽位缺不缺无所谓。
    if (isAnimation(image) && usesGivenReference(session, image)) continue;
    deps.emit(session, 'plan', image.id + ' 缺失必填槽位：' + image.spec.missingSlots.join('、') + '，已用兜底值', {
      level: 'warn',
      detail: detail('槽位校验', [
        kv('图', image.id + ' · ' + image.title),
        list('缺失', image.spec.missingSlots.map((label) => ({ tag: 'fail', text: label }))),
        text('兜底后的 prompt', image.spec.prompt),
      ]),
    });
  }
  deps.emit(session, 'plan', '规划完成：' + session.images.length + ' 张图，路线 ' + session.route, {
    durMs: Date.now() - startedAt,
    detail: detail('规划结果', [
      kv('路线', session.route === 'fast' ? 'fast · 单图快速' : 'full · 完整回路'),
      kv('出图数', session.images.length),
      kv('检索意图', refQuerySummary),
      list('分诊思考', session.think),
      list('我自己定的', session.assumptions.map((item) => ({ text: item }))),
      list(
        '出图前要问你',
        session.blockers.map((item) => ({ text: item.text, tag: 'warn', note: (item.options || []).join(' / ') })),
      ),
      ...session.images.map((image) =>
        group(image.id + ' · ' + image.title, [
          kv('入口', image.spec.entry === 'edit' ? '带参考图编辑' : '文生图'),
          kv('难度', difficultyText(image)),
          kv('尺寸', image.spec.area + ' · ' + image.spec.aspectRatio),
          kv('参考图', image.spec.refs.length ? image.spec.refs.join('、') : '无'),
          (image.spec.qrCodes || []).length
            ? kv(
                '二维码',
                image.spec.qrCodes
                  .map((item) =>
                    item.content
                      ? '「' + item.content + '」' + (item.verbatim ? '（逐字核对通过，出图后贴真码）' : '（原话里找不到，不贴真码）')
                      : '没给内容（装饰码）',
                  )
                  .join('；'),
              )
            : null,
          image.blocked ? kv('阻塞原因', image.blockReason) : null,
          image.spec.animation
            ? kv(
                '动图',
                image.spec.animation.frames.length + ' 帧，每帧 ' + image.spec.animation.frameMs + ' 毫秒，' +
                  (transitionOf(image.spec.animation) === 'cut' ? '帧间直接切换，' : '帧间渐变，') +
                  (usesGivenReference(session, image)
                    ? '直接从 ' + image.spec.animation.reference + ' 改出各帧'
                    : '先画参考图，你确认后再出各帧'),
              )
            : null,
          image.spec.motionGif
            ? kv(
                '程序转圈 GIF',
                (image.spec.motionGif.spin.steps ? '一圈 ' + image.spec.motionGif.spin.steps + ' 格、一格一格跳' : '连续转') +
                  '，图画好、评审通过后由程序绕圆心转出各帧，不另外生图',
              )
            : null,
          image.spec.panelGif
            ? kv(
                '组图拼 GIF',
                (image.spec.panelGif.rows && image.spec.panelGif.cols ? image.spec.panelGif.cols + ' 列 ' + image.spec.panelGif.rows + ' 行，' : '') +
                  '组图画好、评审通过后由程序切格拼成 GIF，不另外生图',
              )
            : null,
          image.spec.missingSlots && image.spec.missingSlots.length
            ? kv('槽位告警', '缺失必填槽位 ' + image.spec.missingSlots.join('、') + '，已用兜底值')
            : null,
          list(
            'prompt 槽位',
            SLOT_SPEC.map((spec) => ({
              tag: image.spec.slots && image.spec.slots[spec.key] ? '' : spec.required ? 'fail' : '',
              text: spec.label + '：' + ((image.spec.slots && image.spec.slots[spec.key]) || '（空）'),
            })).concat([
              { text: '图内文字：' + ((image.spec.slots && image.spec.slots.text) || '（无）') },
              { text: '排除项：' + ((image.spec.slots && image.spec.slots.negative) || '（无）') },
            ]),
          ),
          text('槽位拼装后的 prompt（送进模型）', image.spec.prompt),
          list(
            '验收清单',
            image.spec.checklist.map((item) => ({
              tag: item.kind,
              text: item.id + ' [' + item.kind + '] ' + item.text,
            })),
          ),
        ]),
      ),
    ]),
  });
  return data;
}

function normalizePlan(data, session) {
  const list = Array.isArray(data.images) ? data.images : [];
  const used = new Set();
  const sources = qrSources(session);
  return list.map((raw, index) => {
    let id = String(raw.id || String.fromCharCode(65 + index)).toUpperCase().slice(0, 4);
    while (used.has(id)) id += '1';
    used.add(id);
    const refs = Array.isArray(raw.refs) ? raw.refs.filter(Boolean) : [];
    const textLayers = Array.isArray(raw.text_layers) ? raw.text_layers : [];
    const qrCodes = normalizeQrCodes(raw.qr_codes, sources);
    const subjectText = [raw.title, raw.prompt, raw.slots && raw.slots.subject, raw.slots && raw.slots.scene]
      .filter(Boolean)
      .join(' ');
    const checklist = normalizeChecklist(raw.checklist, textLayers, subjectText, qrCodes);
    const questions = (Array.isArray(raw.questions) ? raw.questions : [])
      .map((item) => (typeof item === 'string' ? item : (item && (item.text || item.question)) || ''))
      .filter(Boolean);
    const hasSlots = Boolean(raw.slots && typeof raw.slots === 'object');
    const slots = hasSlots ? normalizeSlots(raw.slots, textLayers) : null;
    const composed = composePrompt(slots, raw.prompt, session.instruction, hasSlots, qrCodes);
    const textOverlay = normalizeTextOverlay(
      raw.text_overlay,
      textLayers,
      [session.instruction, raw.title, slots && slots.style, slots && slots.subject].filter(Boolean).join(' '),
    );
    const chartPlan = normalizeCharts(raw.charts);
    const charts = chartsWithCheck(chartPlan.charts, sources);
    return {
      id,
      title: raw.title || '图 ' + id,
      blocked: Boolean(raw.blocked) || questions.length > 0,
      blockReason: questions.join('；'),
      chartProblems: chartPlan.problems,
      spec: {
        slug: normalizeSlug(raw.slug, id.toLowerCase()),
        entry: raw.entry === 'edit' || refs.length ? 'edit' : 't2i',
        prompt: composed.prompt || String(raw.prompt || session.instruction),
        slots: composed.slots,
        missingSlots: composed.missing,
        hasSlots,
        aspectRatio: raw.aspect_ratio || 'auto',
        area: raw.area || DEFAULTS.area,
        size: raw.size || '',
        refs,
        textLayers,
        qrCodes,
        textOverlay,
        basePrompt: '',
        animation: normalizeAnimation(raw.animation),
        // 动图、程序转圈、组图拼 GIF 只取一种，按这个顺序：规划写了好几个，取前面的。切换时弹一下只在用户原话里点名才加（见 editPanelGif）。
        motionGif: normalizeAnimation(raw.animation) ? null : normalizeMotionGif(raw.motion_gif),
        panelGif: normalizeAnimation(raw.animation) || normalizeMotionGif(raw.motion_gif) ? null : withoutUnaskedBounce(normalizePanelGif(raw.panel_gif), session.instruction),
        charts,
        // 规划判的难度：决定后面各节点的工具调用上限（见 budget.mjs）。没写就按规格推断。
        difficulty: normalizeDifficulty(raw.difficulty),
        difficultyReason: String(raw.difficulty_reason || '').trim().slice(0, 60),
        checklist: withWhiteCheck(chartChecklist(checklist, charts), wantsWhite(session, { spec: { slots: composed.slots } })),
      },
      rounds: [],
      status: 'pending',
      chosen: null,
      textMode: '',
    };
  });
}

// 文字层硬项上限。文字标签只是辅助信息，一条一条挂 hard 会把 hard 名额吃光，
// 反而把 planner 写的「手型对不对」这类真正的要求挤出局（真机 20261110-5e10ae：
// A 图 26 个字母标签生成 26 条 T 项，T1-T5 占满 hard 名额，4 条手型检查全被降级成
// soft，soft 不参与放行，于是「手指摆成印刷体字母」照样判通过）。
// 超过上限的部分合并成一条聚合项，仍然可判定，但只占一个名额。
const MAX_TEXT_HARD = 3;

// 文字层对应的 T 项：前 MAX_TEXT_HARD 条一条一项，其余合并成一条聚合项。
function textChecks(textLayers) {
  const out = [];
  const layers = [];
  for (const layer of Array.isArray(textLayers) ? textLayers : []) {
    const text = typeof layer === 'string' ? layer : layer && layer.text;
    if (!text) continue;
    if (layers.indexOf(text) < 0) layers.push(text);
  }
  const headLayers = layers.slice(0, MAX_TEXT_HARD);
  const tailLayers = layers.slice(MAX_TEXT_HARD);
  for (let i = 0; i < headLayers.length; i += 1) {
    out.push({
      id: 'T' + (i + 1),
      kind: 'hard',
      text: '画面里出现文字「' + headLayers[i] + '」且字形正确可读',
      verify: 'vlm',
    });
  }
  if (tailLayers.length) {
    out.push({
      id: 'T' + (headLayers.length + 1),
      kind: 'hard',
      text:
        '画面里的文字「' + tailLayers.join('」「') + '」全部出现，字形正确可读，没有错字、缺漏或重复',
      verify: 'vlm',
    });
  }
  return out;
}

function normalizeChecklist(checklist, textLayers, subjectText, qrCodes) {
  const items = Array.isArray(checklist) ? checklist : [];
  // 文字层是用户明确点名的可验证项，排在最前面，保证不会被 hard 上限截掉；
  // 但数量必须封顶，否则它会把 planner 写的语义要求全部挤出去。
  const out = textChecks(textLayers);
  for (const item of items) {
    if (!item || !item.text) continue;
    const text = String(item.text);
    if (out.some((existing) => existing.text === text)) continue;
    // H-qr 只能由程序按 qr_codes 挂上：评审看不出码能不能扫，规划自己写的同名条目一律不收。
    if (String(item.id || '') === 'H-qr') continue;
    out.push({
      id: String(item.id || (item.kind === 'soft' ? 'S' : 'H') + (out.length + 1)),
      kind: item.kind === 'soft' ? 'soft' : 'hard',
      text,
      verify: item.verify === 'program' ? 'program' : 'vlm',
    });
  }
  if (!out.some((item) => item.kind === 'hard')) {
    out.push({ id: 'H1', kind: 'hard', text: '画面内容与用户需求一致，主体完整无畸形', verify: 'vlm' });
  }
  // hard 项越多，评审越容易挑刺、越容易把图打回；超出上限的部分降级成 soft。
  let hardSeen = 0;
  const capped = [];
  for (const item of out) {
    if (item.kind !== 'hard') {
      capped.push(item);
      continue;
    }
    hardSeen += 1;
    if (hardSeen <= DEFAULTS.maxHardItems) capped.push(item);
    else capped.push({ ...item, kind: 'soft', id: item.id.startsWith('T') ? item.id : 'S-' + item.id });
  }
  const limited = capped.slice(0, DEFAULTS.maxHardItems + 4);
  // 色彩是程序最容易漏、评审又不会主动看的一维：程序层只做配平，配平不下来的偏色
  // 以前只留一个 soft warn 就交付了（实测「加字」那一版整体偏红 1.21 照样过）。
  // 固定挂一条 soft 项，评审必须对色调表态，但 soft 不参与放行，不会把图打回。
  if (!limited.some((item) => item.id === COLOR_CHECK.id)) limited.push({ ...COLOR_CHECK });
  // 色彩同时挂一条 hard：程序实测 redGain 超标就打回重画。
  // 必须放在 hard 上限裁剪之后，否则会被降级成 soft（soft 不参与放行）。
  if (!limited.some((item) => item.id === COLOR_HARD_CHECK.id)) limited.push({ ...COLOR_HARD_CHECK });
  // 解剖畸形是用户一眼能看出来、评审却最容易漏的一维（真机 20261110-c5bf7a 图 C：托猫的手
  // 多指畸形，清单里没有任何解剖项，评审只核对了主体存在性和风格就给 8.5 分放行）。
  // 只在画面里确实有人或动物时注入：纯风景、产品图挂这条只会制造无谓打回。
  if (subjectText && ANATOMY_SUBJECT.test(subjectText)
    && !limited.some((item) => item.id === ANATOMY_CHECK.id)) {
    limited.push({ ...ANATOMY_CHECK });
  }
  // 二维码同样挂在裁剪之后：它是程序实测的硬项，被降级成 soft 就等于不验。
  return withQrCheck(limited, qrCodes);
}

// 交付文件名：H3-Image_<内容英文简写>_<时间戳>.<ext>。
// slug 由规划节点产出；拿不到就退回图号，保证老会话和规划失败时照样能交付。
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function normalizeSlug(raw, fallback) {
  const text = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  return text && SLUG_RE.test(text) ? text : String(fallback || 'image');
}

function fileStamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return String(date.getFullYear()) + pad(date.getMonth() + 1) + pad(date.getDate())
    + '-' + pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds());
}

// 画面里出现人或动物时才注入解剖硬项。纯风景、产品图不挂，避免无谓打回。
const ANATOMY_SUBJECT = /(人物|人像|男人|女人|女孩|男孩|小孩|儿童|孩童|少年|少女|老人|婴儿|宝宝|角色|主角|群像|脸|面孔|手|手指|腿|脚|身体|肖像|全身|半身|坐姿|站姿|躺|卧|猫|狗|兔|熊|鸟|马|牛|羊|猪|鸡|鸭|鱼|龙|动物|宠物|拟人|玩偶|娃娃|person|people|man|men|woman|women|girl|boy|child|children|kid|baby|portrait|face|hand|finger|leg|foot|cat|dog|rabbit|bear|bird|horse|animal|pet)/i;

const ANATOMY_CHECK = {
  id: 'H-anatomy',
  kind: 'hard',
  verify: 'vlm',
  text: '画面里的人物或动物肢体解剖正确：手指数量正确、指节与关节走向自然、四肢没有扭曲/多肢/缺失、五官位置正常；风格化的简化不算畸形',
};

// 固定挂在每张图验收清单末尾的色彩项。措辞上排除"刻意设计的暖调/冷调"，
// 否则日落、烛光这类本来就要暖的题材会被反复判偏色。
const COLOR_CHECK = {
  id: 'S-color',
  kind: 'soft',
  verify: 'vlm',
  text: '整体色彩自然：没有明显的整体偏色（发红、发绿、整体偏冷）或色阶断层；刻意设计的暖调/冷调不算偏色',
};

// 程序实测的硬性色彩项：只有红增益真的超标才 fail。
// 判据要「相对父图变红」和「绝对 redGain ≥ RED_ABS_LIMIT」两条同时成立——
// 只看相对漂移会被一张很蓝的父图带偏：真机 20261109-691283 第 3 轮的子图 redGain 只有
// 0.9667（压根不红），却因为父图 0.8044 被标成「相对父图发红」，差点被当成偏红打回。
const RED_ABS_LIMIT = 1.08;
// 不管有没有父图、红到什么程度一律判偏红。只靠相对漂移不够：上一轮如果已经交付了一张
// 偏红的图，下一轮的父图本身就是红的，相对漂移恒为 0，检测会彻底失效（roundbase 回归实测）。
// 1.2 高于常见「刻意暖调」的调色量级，日落、烛光这类题材不会被误伤。
const RED_HARD_LIMIT = 1.2;
// 接近中性的像素至少占这么多，才拿它们来区分「整体偏红」和「主体本身是红的」。
// 真机 20261112-23b706（暖光产品照）8 张候选全被判偏红；橘猫吉祥物的 GIF 参考图同样每张都被打回。
const NEUTRAL_MIN_SHARE = 0.05;
const COLOR_HARD_CHECK = {
  id: 'H-color',
  kind: 'hard',
  verify: 'program',
  text:
    '整体白平衡中性：红通道不得明显压过绿蓝通道（程序实测：相对父图漂移成立时 redGain ≥ ' +
    RED_ABS_LIMIT +
    '，或绝对 redGain ≥ ' +
    RED_HARD_LIMIT +
    '，任一成立即判偏红）',
};

// ---------------------------------------------------------------- 04/05/06 单图循环

async function runImage(session, image, deps) {
  let maxRefine = session.route === 'fast' ? DEFAULTS.maxRefineFast : DEFAULTS.maxRefine;
  // 评审判出字的位置有问题（压线、出界、该在色块里却在外面）时，在同一张底图上重新排字：不调生图接口，
  // 几秒钟就好，所以不占生图的轮次；每张图最多两次，免得来回挪个没完。
  let textFixes = 0;
  const maxTextFixes = 2;
  image.status = 'running';
  let action = image.pendingAction || {
    type: image.spec.entry === 'edit' ? 'edit' : 'generate',
    prompt: promptFor(image),
    refs: image.spec.refs,
    parentId: null,
  };
  image.pendingAction = null;
  let fullEdits = 0;
  let staleRounds = 0;
  let bestHard = -1;
  // 偏红重画单独计数：它不算「没改善」，不该把 stale 判定和轮次预算搅乱。
  let colorRetries = 0;
  const maxColorRetries = session.route === 'fast' ? 1 : 2;
  // 二维码没贴成的重画同理单独计数。
  let qrRetries = 0;
  const maxQrRetries = session.route === 'fast' ? 1 : 2;
  const wantsQr = qrContents(image.spec).length > 0;
  // 程序排字时底图没留出空白的重画，同样单独计数。
  let textRetries = 0;
  const maxTextRetries = session.route === 'fast' ? 1 : 2;
  let chartRetries = 0;
  const maxChartRetries = session.route === 'fast' ? 1 : 2;
  // 白纸、白底偏色的重画也单独计数。
  let whiteRetries = 0;
  const maxWhiteRetries = session.route === 'fast' ? 1 : 2;
  const warm = imageWarm(session, image);
  // 接口取不到送进去的图的次数，见下面的 isUnreachableMedia。
  let unreachable = 0;
  // 生图接口临时故障（网关 5xx、断连）的轮数。h3.mjs 每次请求已经退避重试过两次，走到这里说明故障还没过去。
  let outages = 0;
  image.interrupted = '';
  let lastActionType = action.type;

  for (let round = 0; round <= maxRefine; round += 1) {
    if (isCancelled(session)) return;
    // 底图在这一步就解析好：轨迹必须显示真正送进模型的那张图，
    // 不能显示一个解析不到的 id，否则「在 A-r1-g1 上编辑」会骗人。
    const parent = resolveParent(image, action);
    const requestedParentId = action.parentId || null;
    if (action.type === 'edit') {
      action.parentId = parent ? parent.id || action.parentId : null;
      action.parentPath = parent ? parentImagePath(image, parent) : null;
      action.parentStats = (parent && parent.program && parent.program.stats) || action.parentStats || null;
    }
    const retype = action.type === 'text';
    if (!retype) action = ensureChartClause(ensureTextClause(ensureQrClause(action, parent, image), image), image);
    action.overlay = isOverlay(image);
    const record = { index: round, action: summarizeAction(action), candidates: [], startedAt: Date.now() };
    image.rounds.push(record);
    const roundAnchor = action.type === 'edit' ? anchorFor(image, parent) : null;
    deps.emit(session, 'paint', image.id + ' 第 ' + (round + 1) + ' 轮：' + describeAction(action) + (roundAnchor ? '，带色彩基准 ' + roundAnchor.id : ''), {
      detail: detail('本轮动作', [
        kv('类型', retype ? '只重新排字（不重新生图）' : action.type !== 'edit' ? '重新生成' : parent ? '在已有图上编辑' : '按参考图生成'),
        kv('底图', retype ? (action.parentId || '-') + ' 不带字的底图' : action.type !== 'edit' ? '无' : parent ? parent.id || '上一张' : '没找到，已退化成按参考图生成'),
        roundAnchor ? kv('色彩基准', roundAnchor.id + '（作为第 2 张图送进去，只对照颜色）') : null,
        retype ? list('挪动的段落', (action.textPatches || []).map((patch) => ({ text: '第 ' + patch.index + ' 段 → ' + JSON.stringify(patch.box || patch.align) }))) : null,
        retype ? null : kv('参考图', (action.refs || []).join('、') || '无'),
        retype ? null : kv('候选数', session.route === 'fast' ? 1 : DEFAULTS.candidates),
        isOverlay(image) && !retype ? kv('文字', '这一轮画不带字的底图，文字由程序按原文排进去') : null,
        hasCharts(image) && !retype ? kv('图表', '这一轮画留出空白面板的底图，图表由程序按数据画进去') : null,
        retype ? null : text('送进模型的 prompt', action.prompt),
      ]),
    });

    let candidates = [];
    try {
      candidates = await executeAction(session, image, action, deps);
    } catch (error) {
      record.error = describeError(error);
      image.failReason = record.error;
      deps.emit(session, 'paint', image.id + ' 生成失败：' + record.error, { level: 'error' });
      // 配置类错误（缺 Key、401/403、模型名不对）重试没用，立刻停下；但前面几轮已经生成好的图照样交付。
      // 以前这里直接判死，手上的图一张不交（真机 20261112-23b706 / 463fcd 各丢了 8 张、4 张）。
      if (isFatal(error)) {
        session.fatal = record.error;
        await stopWithExisting(session, image, deps, record.error);
        return;
      }
      // 安全审核拒绝没有重试价值：prompt 一个字没改，再送 5 次也是同样的 422。
      // 立刻停手，把接口原文和「怎么改」一起顶到对话层，让用户改需求重来。
      if (isContentPolicy(error)) {
        image.contentPolicy = true;
        deps.emit(session, 'paint', image.id + ' 被内容安全审核拒绝，已停止重试', {
          level: 'error',
          detail: detail('内容安全审核拒绝', [
            kv('图', image.id + ' · ' + image.title),
            kv('接口返回', record.error),
            text('送进模型的 prompt', action.prompt || image.spec.prompt),
            text(
              '怎么改',
              '这类拒绝是确定性的，重画和换画法都不会过。请修改需求本身（例如换成原创角色或别的题材）后再重新发起。',
            ),
          ]),
        });
        session.questions.push(
          image.id + ' 被内容安全审核拒绝，需要改掉触发审核的描述后重画：' + record.error,
        );
        await stopWithExisting(session, image, deps, '后面这一轮被内容安全审核拒绝');
        return;
      }
      // 接口取不到送进去的图（media url unreachable）：同样的请求再送多少次都一样。现在送进去的
      // 只有自己上传的文件，这类错误多半是接口那边一时取不到：再试一次，还不行就停手交给选优，
      // 不要像以前那样原样重试到轮次用完（真机 20261112-8a442a 连败 6 轮，交付 0 张）。
      if (isUnreachableMedia(error)) {
        unreachable += 1;
        if (unreachable >= 2) {
          deps.emit(session, 'paint', image.id + ' 接口连续两次取不到送进去的图，停止重试', { level: 'error' });
          image.interrupted = '生图接口连续两次取不到送进去的图';
          break;
        }
      }
      // 生图接口临时故障，而且 h3.mjs 里已经退避重试过两次：手上已经有图就不再出新图，先把它们交出去；
      // 一张都还没有，就再等一会儿试一轮，还不行才停。
      if (isTransient(error)) {
        outages += 1;
        const reason = '生图接口暂时不可用（' + shortError(record.error) + '）';
        if (hasCandidates(image)) {
          deps.emit(session, 'paint', image.id + ' ' + reason + '，重试仍失败，先交付已经生成好的图', { level: 'warn' });
          image.interrupted = reason;
          break;
        }
        if (outages >= 2 || round >= maxRefine) {
          deps.emit(session, 'paint', image.id + ' ' + reason + '，连续两轮都没恢复，停止重试', { level: 'error' });
          break;
        }
        deps.emit(session, 'paint', image.id + ' ' + reason + '，' + Math.round(DEFAULTS.outageWaitMs / 1000) + ' 秒后再试', {
          level: 'warn',
        });
        await waitUnlessCancelled(session, DEFAULTS.outageWaitMs);
        if (isCancelled(session)) return;
      }
      if (round >= maxRefine) break;
      action = { type: 'generate', prompt: promptFor(image), refs: image.spec.refs, parentId: null };
      continue;
    }
    record.candidates = candidates;
    // 生图请求停不下来，但它回来之后不该再起评审回合。
    if (isCancelled(session)) return;
    if (!candidates.length) {
      if (round >= maxRefine) break;
      continue;
    }

    // 程序实测和评审都是会抛的：Host 把 agent turn 判成 error（实测过一次卡 205 秒后 error）、
    // 回复不是合法 JSON、用户中途点停止。以前这里没有兜底，异常会一路抛出 runImage，
    // 整张图直接判死、交付 0 张，连重试的机会都没有——图其实已经生成好了。
    // 现在按「这一轮失败」处理：还能重试就重来，轮次用完就交给选优。
    let verdict;
    let judgeStartedAt = Date.now();
    try {
      await Promise.all(candidates.map((candidate) => programChecks(session, image, candidate, deps)));
      noteColorAnchor(session, image, candidates, deps);
      // 全部候选都被程序判成偏红时，没必要再花两三分钟让评审看一遍——它也看不出红。
      // 直接重画一轮，并把「上一轮偏红」写进 prompt。评审节点照样会在别的失败上跑。
      const redAll =
        candidates.length > 0 && candidates.every((candidate) => candidate.program && candidate.program.redCast);
      if (redAll && colorRetries < maxColorRetries && round < maxRefine) {
        colorRetries += 1;
        record.verdict = { note: '全部候选偏红，跳过评审直接重画' };
        deps.emit(
          session,
          'refine',
          image.id + ' 第 ' + (round + 1) + ' 轮候选全部偏红，跳过评审直接重画（' + colorRetries + '/' + maxColorRetries + '）',
          { level: 'warn' },
        );
        // 只有「本来就指定了父图」的编辑轮才继续在同一张父图上重画；
        // 那种因为 entry 被判成 edit、实际没有底图的轮次必须回到重新生成——
        // 在刚生成的偏红图上做全图 edit 只会继续累积偏色。
        action = requestedParentId
          ? { ...action, prompt: withColorRetry(action.prompt, warm) }
          : { type: 'generate', prompt: withColorRetry(promptFor(image), warm), refs: image.spec.refs, parentId: null };
        continue;
      }
      // 白纸、白底全部偏色：H-white 是硬项，评审看完也只能打回。直接带着偏的方向重画；
      // 编辑轮还在同一张父图上改，但会带上色彩基准图（见 executeAction），不会越改越偏。
      const whiteAll = candidates.length > 0 && candidates.every((candidate) => candidate.program && candidate.program.whiteCast);
      if (whiteAll && whiteRetries < maxWhiteRetries && round < maxRefine) {
        whiteRetries += 1;
        const label = candidates[0].program.whiteCast;
        record.verdict = { note: '全部候选的白色纸面' + label + '，跳过评审直接重画' };
        deps.emit(
          session,
          'refine',
          image.id + ' 第 ' + (round + 1) + ' 轮候选的白色纸面全部' + label + '，跳过评审直接重画（' + whiteRetries + '/' + maxWhiteRetries + '）',
          { level: 'warn' },
        );
        action = requestedParentId
          ? { ...action, prompt: withWhiteRetry(action.prompt, label) }
          : { type: 'generate', prompt: withWhiteRetry(promptFor(image), label), refs: image.spec.refs, parentId: null };
        continue;
      }
      // 全部候选的二维码都没贴成（找不到码、码太小、贴上扫不出）：H-qr 是硬项，评审看完也只能打回，
      // 而原因程序已经知道了。直接带着原因重画，把评审的两三分钟省下来。
      const qrAll =
        wantsQr &&
        candidates.length > 0 &&
        candidates.every((candidate) => candidate.program && candidate.program.qr && candidate.program.qr.status === 'failed');
      if (qrAll && qrRetries < maxQrRetries && round < maxRefine) {
        qrRetries += 1;
        const why = qrFailText(candidates[0].program.qr);
        // 送进模型的只要原因本身，像素数对生图模型没有意义。
        const whyForModel = dedupe(
          candidates[0].program.qr.items.filter((item) => !item.ok).map((item) => item.reasonText),
        ).join('；');
        record.verdict = { note: '全部候选的二维码都没换成真码，跳过评审直接重画' };
        deps.emit(
          session,
          'refine',
          image.id + ' 第 ' + (round + 1) + ' 轮候选的二维码都没换成真码（' + why + '），跳过评审直接重画（' + qrRetries + '/' + maxQrRetries + '）',
          { level: 'warn' },
        );
        action = requestedParentId
          ? { ...action, prompt: withQrRetry(action.prompt, whyForModel) }
          : { type: 'generate', prompt: withQrRetry(promptFor(image), whyForModel), refs: image.spec.refs, parentId: null };
        continue;
      }
      // 程序排字：全部候选的底图都没给文字留出空白（或者留的地方排不下），H-text 是硬项，评审看完也只能打回。
      // 直接带着原因重画。字体缺字这类和底图无关的问题，重画没用，退回让模型直接写字。
      const textFailed =
        isOverlay(image) &&
        candidates.length > 0 &&
        candidates.every((candidate) => candidate.program && candidate.program.text && candidate.program.text.status === 'failed');
      if (textFailed) {
        const fontProblem = candidates.every((candidate) =>
          (candidate.program.text.items || []).some((item) => ['no_font', 'missing_glyphs'].includes(item.reason)),
        );
        if (fontProblem && round < maxRefine) {
          const why = textFailText(candidates[0].program.text);
          leaveOverlay(image);
          record.verdict = { note: '程序排不了这段字（' + why + '），改回让模型直接写' };
          deps.emit(session, 'refine', image.id + ' 程序排不了这段字（' + why + '），改回让模型直接写字', { level: 'warn' });
          action = { type: 'generate', prompt: image.spec.prompt, refs: image.spec.refs, parentId: null };
          continue;
        }
        if (!fontProblem && textRetries < maxTextRetries && round < maxRefine) {
          textRetries += 1;
          const why = textFailText(candidates[0].program.text);
          const whyForModel = dedupe(
            candidates[0].program.text.items.filter((item) => !item.ok).map((item) => item.reasonText),
          ).join('；');
          record.verdict = { note: '全部候选的底图都没给文字留出空白，跳过评审直接重画' };
          deps.emit(
            session,
            'refine',
            image.id + ' 第 ' + (round + 1) + ' 轮候选的字没排上（' + why + '），跳过评审直接重画（' + textRetries + '/' + maxTextRetries + '）',
            { level: 'warn' },
          );
          action = requestedParentId
            ? { ...action, prompt: withTextRetry(action.prompt, whyForModel) }
            : { type: 'generate', prompt: withTextRetry(promptFor(image), whyForModel), refs: image.spec.refs, parentId: null };
          continue;
        }
      }
      // 图表同理：全部候选的底图都没给图表留出空白面板（或者留的地方太小），H-chart 是硬项，评审看完也只能打回。
      const chartFailed =
        hasCharts(image) &&
        candidates.length > 0 &&
        candidates.every((candidate) => candidate.program && candidate.program.chart && candidate.program.chart.status === 'failed');
      if (chartFailed && chartRetries < maxChartRetries && round < maxRefine) {
        const fixable = candidates.some((candidate) =>
          (candidate.program.chart.items || []).some((item) => ['not_blank', 'marks', 'too_small'].includes(item.reason)),
        );
        if (fixable) {
          chartRetries += 1;
          const why = chartFailText(candidates[0].program.chart);
          const whyForModel = dedupe(candidates[0].program.chart.items.filter((item) => !item.ok).map((item) => item.reasonText)).join('；');
          record.verdict = { note: '全部候选的底图都没给图表留出空白面板，跳过评审直接重画' };
          deps.emit(
            session,
            'refine',
            image.id + ' 第 ' + (round + 1) + ' 轮候选的图表没画上（' + why + '），跳过评审直接重画（' + chartRetries + '/' + maxChartRetries + '）',
            { level: 'warn' },
          );
          action = requestedParentId
            ? { ...action, prompt: withChartRetry(action.prompt, whyForModel) }
            : { type: 'generate', prompt: withChartRetry(promptFor(image), whyForModel), refs: image.spec.refs, parentId: null };
          continue;
        }
      }
      judgeStartedAt = Date.now();
      verdict = await judgeWithRetry(session, image, record, deps);
      if (!verdict) {
        // 评审等了一会儿重来还是没跑成：这批图本身是好好的，别扔掉去重画（以前就是这样撞上接口故障、
        // 最后一张不交的）。不再出新图，按程序校验结果和已有的评审结论交给选优。
        record.verdict = { note: '评审没跑成，这批图未经评审，按程序校验结果交给选优' };
        image.interrupted = '评审没跑成（模型服务暂时不可用），这批图未经评审';
        break;
      }
      record.verdict = verdict.summary;
    } catch (error) {
      const message = describeError(error);
      record.error = message;
      deps.emit(session, 'verify', image.id + ' 第 ' + (round + 1) + ' 轮评审异常：' + message, { level: 'error' });
      if (isFatal(error)) {
        session.fatal = message;
        await stopWithExisting(session, image, deps, message);
        return;
      }
      // 用户主动停的，别再自顾自重试。
      if (session.status === 'cancelled') return;
      if (round >= maxRefine) break;
      action = { type: 'generate', prompt: promptFor(image), refs: image.spec.refs, parentId: null };
      continue;
    }
    const bestVerdict = verdict.best ? verdict.best.verdict : null;
    const hardPassed = bestVerdict ? bestVerdict.hardPassed : 0;
    const total = verdict.summary.hardTotal;
    deps.emit(
      session,
      'verify',
      image.id + ' 第 ' + (round + 1) + ' 轮评审：hard ' + hardPassed + '/' + total +
        (bestVerdict && bestVerdict.hardUncertain.length ? '（' + bestVerdict.hardUncertain.length + ' 项拿不准放行）' : '') +
        '，质量 ' + (bestVerdict ? bestVerdict.quality : '-'),
      {
        durMs: Date.now() - judgeStartedAt,
        detail: detail('评审结论 · 第 ' + (round + 1) + ' 轮', [
          kv('判定', verdict.passed ? '通过，进入交付' : '打回，进入修正'),
          kv('看图材料', candidates.map((candidate) => candidate.id + '-sheet.png').join('、')),
          ...candidates.map((candidate) =>
            group(candidate.id, [
              kv(
                'hard',
                candidate.verdict.hardPassed + '/' + candidate.verdict.hardTotal +
                  (candidate.verdict.hardUncertain.length
                    ? '（' + candidate.verdict.hardUncertain.length + ' 项拿不准但放行）'
                    : ''),
              ),
              kv('质量分', candidate.verdict.quality),
              text('总评', candidate.verdict.summary),
              list(
                '逐项判定',
                image.spec.checklist.map((item) => {
                  const hit = candidate.verdict.checks[item.id];
                  const result = hit ? hit.result : '未评';
                  return {
                    tag: result === 'pass' ? 'pass' : result === 'fail' ? 'fail' : result === 'uncertain' ? 'warn' : '',
                    text: item.id + ' [' + item.kind + '] ' + item.text,
                    note: hit && hit.note ? hit.note : '',
                  };
                }),
              ),
              candidate.verdict.extraFails && candidate.verdict.extraFails.length
                ? list(
                    '评审发现的清单外问题（按 hard fail 处理）',
                    candidate.verdict.extraFails.map((id) => ({
                      tag: 'fail',
                      text: id,
                      note: (candidate.verdict.checks[id] || {}).note || '',
                    })),
                  )
                : null,
            ]),
          ),
          verdict.next
            ? group('评审建议的下一步', [
                kv('动作', verdict.next.type),
                kv('目标候选', verdict.next.parentId || '-'),
                text('理由', verdict.next.reason),
                text('指令', verdict.next.prompt),
              ])
            : null,
        ]),
      },
    );

    if (verdict.passed && verdict.best) {
      image.chosen = verdict.best;
      image.status = 'passed';
      deps.emit(session, 'verify', image.id + ' 通过：' + verdict.best.id);
      return;
    }

    // 兜底：模型直接写的字在这一轮的每张候选上都被评审判成写错、漏字（T 项 fail），换成无字底图 + 程序排字。
    // 再让模型重画同一段字多半还是残的（真机 20261113-01b902）。不知道字该放哪的短字不切（见 canPlaceText）。
    if (!isOverlay(image) && canPlaceText(image) && round < maxRefine && textBrokenEverywhere(candidates)) {
      const failedIds = dedupe(
        candidates.flatMap((candidate) => ((candidate.verdict && candidate.verdict.hardFailed) || []).filter((id) => /^T\d+$/.test(id))),
      );
      const note = failedIds
        .map((id) => (verdict.best && verdict.best.verdict.checks[id] && verdict.best.verdict.checks[id].note) || '')
        .filter(Boolean)
        .join('；');
      enterOverlay(session, image, '第 ' + (round + 1) + ' 轮模型写的字画残了' + (note ? '（' + note + '）' : ''));
      deps.emit(session, 'refine', image.id + ' 第 ' + (round + 1) + ' 轮模型写的字画残了，改成先画不带字的底图、文字由程序按原文排进去', {
        level: 'warn',
        detail: detail('切换到程序排字 · ' + image.id, [
          kv('原因', image.textReason),
          text('不带字的底图 prompt（送进模型）', image.spec.basePrompt),
        ]),
      });
      record.verdict = { ...record.verdict, note: (record.verdict && record.verdict.note ? record.verdict.note + '；' : '') + '文字画残，改用程序排字' };
      // 清单换了（T 项改由程序验），之前的 hard 通过数不再可比。
      bestHard = -1;
      staleRounds = 0;
      lastActionType = 'generate';
      action = { type: 'generate', prompt: promptFor(image), refs: image.spec.refs, parentId: null };
      continue;
    }

    if (hardPassed > bestHard) {
      bestHard = hardPassed;
      staleRounds = 0;
    } else {
      staleRounds += 1;
    }
    if (staleRounds >= DEFAULTS.staleStopRounds) {
      deps.emit(session, 'refine', image.id + ' 连续 ' + staleRounds + ' 轮没有改善，提前停下并交给选优');
      break;
    }
    // 生图轮次用完了，但评审建议的是只重新排字：不调生图接口，照样可以做。
    if (round >= maxRefine && !(verdict.next && verdict.next.type === 'text' && isExecutable(verdict.next, image) && textFixes < maxTextFixes)) break;

    let next = verdict.next;
    if (!next || !isExecutable(next, image)) {
      next = await safeRefine(session, image, record, verdict, deps);
    }
    if (!next || next.type === 'give_up') {
      deps.emit(session, 'refine', image.id + ' 评审建议放弃本轮，进入选优');
      break;
    }
    if (staleRounds >= DEFAULTS.staleActionRounds && next.type === lastActionType) {
      deps.emit(session, 'refine', image.id + ' 连续没有改善，强制换一种改法');
      next = (await safeRefine(session, image, record, verdict, deps, true)) || next;
      // 强制换改法时修正节点也可能说放弃：不判断的话「放弃」会被当成一个动作，落到生图分支里去。
      if (next.type === 'give_up') {
        deps.emit(session, 'refine', image.id + ' 修正节点建议放弃，进入选优');
        break;
      }
    }
    if (next.type === 'text') {
      if (textFixes >= maxTextFixes) {
        deps.emit(session, 'refine', image.id + ' 已经在原图上重新排过 ' + maxTextFixes + ' 次字，进入选优');
        break;
      }
      textFixes += 1;
      maxRefine += 1;
    }
    if (next.type === 'edit') {
      fullEdits += 1;
      if (fullEdits > DEFAULTS.maxFullEdits) {
        deps.emit(session, 'refine', image.id + ' 全图 edit 已达上限 ' + DEFAULTS.maxFullEdits + ' 次，改走重新生成');
        next = { type: 'generate', prompt: next.prompt || promptFor(image), refs: image.spec.refs, parentId: null };
      }
    }
    lastActionType = next.type;
    action = next;
  }

  await selectBestEffort(session, image, deps);
}

// 修正节点、增量编辑节点都会自己重写 prompt，经常把二维码的要求丢掉，于是模型画出一个歪的、
// 被挡住的码，程序找不到就只能打回。每轮出图前统一补一次：底图上已经是真码时要求保持不动，
// 其余情况要求画一个规整的占位码。
function ensureQrClause(action, parent, image) {
  if (!((image.spec && image.spec.qrCodes) || []).length) return action;
  const prompt = String(action.prompt || '').trim();
  const keep =
    action.type === 'edit' &&
    parent &&
    parent.program &&
    parent.program.qr &&
    parent.program.qr.status === 'real';
  const clause = keep ? QR_KEEP_CLAUSE : QR_CLAUSE;
  if (prompt.includes(clause)) return action;
  return { ...action, prompt: prompt + (prompt && !/[。.!！?？]$/.test(prompt) ? '。' : '') + clause };
}

// 程序排字模式下，修正节点、评审写的指令同样会把「这块留空」丢掉，模型就又在载体上写满伪文字。每轮统一补一次。
function ensureTextClause(action, image) {
  if (!isOverlay(image)) return action;
  const prompt = String(action.prompt || '').trim();
  if (prompt.includes(BLANK_MARK)) return action;
  return {
    ...action,
    prompt: prompt + (prompt && !/[。.!！?？]$/.test(prompt) ? '。' : '') + blankClause(overlayLayers(image)),
  };
}

// 编辑要送进模型的底图。程序排字、程序画图表的图送不带字、不带图表的那张：送画好的图，模型会照着重描一遍，
// 字又写残了，柱子又画歪了。
function parentImagePath(image, parent) {
  if (!parent) return null;
  return (isOverlay(image) || hasCharts(image)) && parent.basePath ? parent.basePath : parent.path;
}

// 这一轮每张评过的候选，模型写的字都被判成写错（T 项 fail）。
function textBrokenEverywhere(candidates) {
  const judged = (candidates || []).filter((candidate) => candidate && candidate.verdict);
  return (
    judged.length > 0 &&
    judged.every((candidate) => (candidate.verdict.hardFailed || []).some((id) => /^T\d+$/.test(id)))
  );
}

// 修正节点也会抛（agent turn 被判 error / 回复不是 JSON）。它挂了不代表这一轮没救，
// 当成「评审没给可执行的下一步」处理，让上层走放弃本轮、交给选优。
async function safeRefine(session, image, record, verdict, deps, forceChange) {
  try {
    return await refineNode(session, image, record, verdict, deps, forceChange);
  } catch (error) {
    deps.emit(session, 'refine', image.id + ' 修正节点异常：' + describeError(error), { level: 'error' });
    return null;
  }
}

// 选优是最后一道兜底，它自己挂了也必须把手上的候选交出去：
// 图已经生成好了，因为选优节点抽风就交付 0 张，是最糟的失败方式。
async function selectBestEffort(session, image, deps) {
  try {
    await selectNode(session, image, deps);
    return;
  } catch (error) {
    deps.emit(session, 'select', image.id + ' 选优节点异常：' + describeError(error), { level: 'error' });
  }
  if (image.chosen) return;
  const best = rankCandidates(allCandidates(image))[0] || null;
  if (!best) {
    image.status = 'failed';
    const why = lastFailReason(image);
    image.failReason = why;
    deps.emit(session, 'select', image.id + ' 没有任何可用候选' + (why ? '：' + why : ''), {
      level: 'error',
      detail: detail('没有可用候选', [
        kv('图', image.id + ' · ' + image.title),
        kv('轮次', image.rounds.length),
        why ? kv('最后一次报错', why) : kv('最后一次报错', '无报错，候选全部未通过程序校验'),
      ]),
    });
    return;
  }
  image.chosen = best;
  image.status = 'unpassed';
  image.chosenReason = '选优节点异常，按验收分数回退';
  deps.emit(session, 'select', image.id + ' 选优节点异常，回退交付：' + best.id, { level: 'warn' });
}

function allCandidates(image) {
  const out = [];
  for (const round of image.rounds || []) {
    for (const candidate of round.candidates || []) if (candidate && candidate.path) out.push(candidate);
  }
  return out;
}

function hasCandidates(image) {
  return allCandidates(image).length > 0;
}

// 没有模型可问时怎么排候选：程序硬项有失败的（解不开、偏红、二维码没换成）排最后，这些是确定的毛病；
// 其余的里，评过的按 hard 通过数、质量分排在没评过的前面；再一样就取后出的（后面的轮次通常是修过的）。
function rankCandidates(list) {
  const score = (candidate) => {
    const programFails = (candidate.checks || []).filter((check) => check.kind === 'hard' && check.result === 'fail').length;
    const verdict = candidate.verdict;
    return [
      programFails ? 0 : 1,
      verdict ? 1 : 0,
      verdict ? Number(verdict.hardPassed) || 0 : 0,
      verdict ? Number(verdict.quality) || 0 : 0,
      Number(candidate.round) || 0,
      Number(candidate.createdAt) || 0,
    ];
  };
  return list.slice().sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    for (let i = 0; i < sa.length; i += 1) if (sa[i] !== sb[i]) return sb[i] - sa[i];
    return 0;
  });
}

// 出图中途停下（配置错误、审核拒绝、接口或模型服务一直不可用）：手上已经有候选就交给选优交付，
// 交付卡片上写明是停下前的图；一张都没有才判失败。
async function stopWithExisting(session, image, deps, why) {
  image.interrupted = why;
  if (!hasCandidates(image)) {
    image.status = 'failed';
    image.failReason = why;
    return;
  }
  deps.emit(session, 'select', image.id + ' 出图中途停下（' + shortError(why) + '），先交付已经生成好的图', { level: 'warn' });
  await selectBestEffort(session, image, deps);
}

// 评审回合没跑成：等一会儿再评同一批图。还不行返回 null，由上层交给选优，不扔掉这批图去重画。
// 配置类错误（Agent 权限被关掉）和用户点停止照常往上抛。
async function judgeWithRetry(session, image, record, deps) {
  try {
    return await judgeNode(session, image, record, deps);
  } catch (error) {
    if (isFatal(error) || isCancelled(session)) throw error;
    deps.emit(
      session,
      'verify',
      image.id + ' 评审没跑成（' + shortError(describeError(error)) + '），' + Math.round(DEFAULTS.judgeRetryWaitMs / 1000) + ' 秒后重新评审同一批图',
      { level: 'warn' },
    );
  }
  await waitUnlessCancelled(session, DEFAULTS.judgeRetryWaitMs);
  if (isCancelled(session)) return null;
  try {
    return await judgeNode(session, image, record, deps);
  } catch (error) {
    if (isFatal(error) || isCancelled(session)) throw error;
    deps.emit(session, 'verify', image.id + ' 重新评审也没跑成：' + shortError(describeError(error)) + '。这批图不再重画，交给选优', {
      level: 'error',
    });
    return null;
  }
}

// 等一段时间，期间用户点了停止就提前返回。
async function waitUnlessCancelled(session, ms) {
  const until = Date.now() + Math.max(0, Number(ms) || 0);
  while (!isCancelled(session) && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(500, Math.max(1, until - Date.now()))));
  }
}

// 时间线上用的短原因：网关的错误页、长串堆栈都截掉。
function shortError(message) {
  const value = String(message || '');
  const status = /HTTP (\d{3})/.exec(value);
  if (status && /Bad Gateway|<html/i.test(value)) return 'HTTP ' + status[1];
  return value.replace(/\s+/g, ' ').slice(0, 80);
}

// 服务端的临时故障：网关 5xx、限流、断连、模型服务把回合判成 error。等一等可能就好了，不能当成配置错误判死。
function isTransient(error) {
  if (!error) return false;
  if (error.transient) return true;
  return /HTTP (429|500|502|503|504)\b|Bad Gateway|Service Unavailable|Gateway Time-?out|fetch failed|ECONNRESET|ECONNREFUSED|socket hang up|TURN_FAILED/i.test(
    describeError(error),
  );
}

// Host 回来的 error 常常是 { code, message } 这种对象，直接 String() 会变成 [object Object]，
// 排查时什么都看不到（实测过一次 agent_error：[object Object]，完全不知道出了啥）。
// 统一在这里展开成「code：message」。
function describeError(error) {
  if (!error) return '未知错误';
  if (typeof error === 'string') return error;
  const raw = error.message !== undefined ? error.message : error;
  let base;
  if (raw === null || raw === undefined) base = error.name || '未知错误';
  else if (typeof raw === 'string') base = raw;
  else if (typeof raw === 'object') {
    const code = raw.code || raw.name || '';
    const body = raw.message || raw.reason || raw.detail || '';
    if (code || body) base = code ? code + '：' + (body || '') : String(body);
    else {
      try {
        base = JSON.stringify(raw);
      } catch {
        base = String(raw);
      }
    }
  } else base = String(raw);
  // Node 的 fetch 失败只给一句 "fetch failed"，真正的原因全在 error.cause 里
  // （ECONNRESET / ENOTFOUND / UND_ERR_* / socket hang up）。不带上它，线上出问题
  // 只能看到一句废话——真机 20261110-c46dde 就是这样：4 张图里 3 张连续 5 轮
  // "fetch failed"，refine 预算烧光、一次评审都没跑就交付了，事后完全查不出原因。
  const cause = error && typeof error === 'object' ? error.cause : null;
  if (cause === null || cause === undefined) return base;
  // cause 允许是字符串（new Error('x', { cause: 'why' }) 是合法写法），
  // 这时它本身就是原因，不能因为「不是对象」就悄悄丢掉。
  const causeCode = typeof cause === 'object' ? cause.code || cause.name || '' : '';
  const causeMsg = typeof cause === 'string'
    ? cause.trim()
    : String((cause && cause.message) || '').trim();
  const extra = [causeCode, causeMsg].filter(Boolean).join(' ').trim();
  return extra && base.indexOf(extra) < 0 ? base + '（' + extra + '）' : base;
}

function isFatal(error) {
  // 用户在插件详情里关掉了 Agent 权限：后面每个节点都会以同样的原因失败，
  // 继续跑只会白烧生图请求，必须当场停下，让页面显示去哪里重新打开。
  if (error && error.code === 'NOT_PERMITTED') return true;
  // 网关 5xx、断连这类临时故障不算：以前「参考图上传失败：HTTP 502」也被当成致命错误，
  // 一次网关故障就让会话判死（真机 20261112-23b706 / 463fcd）。上传失败只有请求本身不对时才致命。
  if (isTransient(error)) return false;
  const message = describeError(error);
  // invalid params / unknown model 是请求本身不对（模型名下线、参数非法），重试多少次都一样。
  // 不当致命错误处理的话，会一路重试到 maxRefine，白烧十几次请求再交付 0 张图。
  return /missing_api_key|missing_base_url|HTTP 401|HTTP 403|HTTP 404|invalid params|unknown model|参考图上传失败|NOT_PERMITTED/.test(message);
}

// 内容安全审核是确定性拒绝：同一个 prompt 送多少次都会被挡下来。
// 实测「米老鼠和龙猫分别打着伞等雨停」被 H3 连拒 6 轮，白烧 100 秒，
// 最后交付 0 张图而且页面上看不出任何原因。这类必须第一轮就停手。
function isContentPolicy(error) {
  return /safety check|content[_ ]?policy|content[_ ]?filter|内容安全|审核不通过|敏感内容|违规内容/i.test(
    describeError(error),
  );
}

// 接口说取不到某张输入图（HTTP 400 · media url unreachable，错误码 2013）。
function isUnreachableMedia(error) {
  return /media url unreachable|\(2013\)/i.test(describeError(error));
}

// 图没出来时要能说清「为什么」。优先报最后一次真实报错，
// 一条报错都没有（比如候选全被程序判死）才回落到笼统说法。
function lastFailReason(image) {
  if (image.failReason) return image.failReason;
  for (let index = image.rounds.length - 1; index >= 0; index -= 1) {
    const round = image.rounds[index];
    if (round && round.error) return round.error;
  }
  return '';
}

function isExecutable(next, image) {
  if (!next || !next.type) return false;
  if (next.type === 'generate') return Boolean(next.prompt);
  if (next.type === 'edit') {
    if (!next.prompt) return false;
    if (next.parentId) return true;
    return Boolean(image.rounds.length);
  }
  if (next.type === 'text') return isOverlay(image) && Boolean(next.parentId) && Boolean((next.textPatches || []).length);
  return next.type === 'give_up';
}

// ---------------------------------------------------------------- 色彩基准
//
// 编辑叠编辑时偏色会一轮一轮累积：每一轮都只偏一点、都在门槛以下，三轮下来白纸就发紫了
// （真机 20261116-41535c：纸面 (253,253,253) → (239,239,240) → (242,242,245) → (245,242,248)）。
// 所以每张图记下第一张颜色检测合格的候选当色彩基准，之后每次在别的候选上编辑，都把它当第 2 张图一起送进去。
// 用户明确要改颜色、光线的那次追问不带（见 runIncrementalEdit），改完以后重新选。
const COLOR_CHANGE_RE =
  /颜色|色调|配色|色彩|暖色|冷色|调暖|调冷|偏暖|偏冷|变暖|变冷|暖一点|冷一点|亮一点|暗一点|调亮|调暗|变亮|变暗|夜景|夜晚|黄昏|傍晚|日落|夕阳|清晨|灯光|光线|打光|逆光|滤镜|黑白|饱和|白天|阴天|雨天|雪景|(?:换|改)成.{0,6}色/;

function colorAccurate(candidate) {
  const program = candidate && candidate.program;
  if (!program || program.error || program.redCast || program.whiteCast) return false;
  return (candidate.checks || []).every((check) => !['H-color', 'H-white', 'P-decode'].includes(check.id) || check.result === 'pass');
}

function noteColorAnchor(session, image, candidates, deps) {
  if (image.colorAnchor && image.colorAnchor.path && existsSync(image.colorAnchor.path)) return;
  const good = (candidates || []).find((candidate) => colorAccurate(candidate));
  if (!good) return;
  // 程序排字、画图表的图用留白的底图：编辑的父图也是底图，两张对照的是同一种画面。
  const path = good.basePath || good.path;
  image.colorAnchor = { id: good.id, path, file: basename(path) };
  deps.emit(session, 'verify', image.id + ' 色彩基准定为 ' + good.id + '：之后在别的候选上编辑时带上它对照颜色');
}

function anchorFor(image, parent) {
  const anchor = image && image.colorAnchor;
  if (!anchor || !anchor.path || !parent) return null;
  if (anchor.id === parent.id || anchor.path === parentImagePath(image, parent)) return null;
  return existsSync(anchor.path) ? anchor : null;
}

function editRolesPrefix(hasAnchor, refCount, refLines) {
  let prefix = '第 1 张图是要修改的原图，请在它基础上修改，保持它的构图、背景、光线与画幅不变；';
  if (hasAnchor) {
    prefix +=
      '第 2 张图是这张图最早、颜色准确的一版，只用来对照颜色：整体色调、白平衡、纸面和背景的白度、明暗都要和第 2 张一致，' +
      '不要整体变暖、变冷、变红、变紫或变暗；不要采用第 2 张里和第 1 张不一样的内容。';
  }
  if (refLines && refLines.length) {
    prefix += (hasAnchor ? '再后面' : '后面') + '的图是参考图，都不是底图，不要采用它们的背景、机位或构图：' + refLines.join('；') + '。';
  } else if (refCount) {
    prefix += (hasAnchor ? '再后面' : '后面') + '的图只是身份/外观参考，不要采用它们的背景、机位或构图。';
  }
  return prefix + '\n\n';
}

async function executeAction(session, image, action, deps) {
  if (action.type === 'text') {
    const made = await retypesetRound(session, image, action, deps);
    deps.emit(session, 'paint', image.id + ' 在 ' + action.parentId + ' 不带字的底图上重新排字，不调生图接口');
    return made;
  }
  // 计量覆盖整个 DiT 环节：参考图上传 + 接口调用 + 图片下载。
  // 之前 started 写在接口调用之后，把最贵的那段漏掉了。
  const started = Date.now();
  const config = deps.config;
  // GIF 的帧每帧只出 1 张：一次评审看全部帧，判了不合格的再单独重画。
  const n = image.spec.candidates || (session.route === 'fast' ? 1 : DEFAULTS.candidates);
  const options = {
    prompt: action.prompt,
    aspectRatio: image.spec.aspectRatio,
    area: image.spec.area,
    n,
  };
  if (image.spec.size) options.size = image.spec.size;

  let result;
  let parent = null;
  let anchor = null;
  let endpoint = 'images/generations';
  if (action.type === 'edit') {
    endpoint = 'images/edits';
    parent = resolveParent(image, action);
    const refs = [];
    // 父图是本地文件，必须先上传换成 mm_file://。直接把它当 image_url 发出去，
    // 接口会回 HTTP 400「only http(s) URL, data:image/*;base64 or mm_file:/」。
    if (parent) refs.push(await h3.resolveReference(config, parentImagePath(image, parent)));
    // 色彩基准图放第 2 张：编辑叠编辑时偏色会一轮轮累积，每次都拿最早那张颜色准确的图对照。
    anchor = anchorFor(image, parent);
    if (anchor) {
      try {
        refs.push(await h3.resolveReference(config, anchor.path));
      } catch (error) {
        deps.emit(session, 'paint', image.id + ' 色彩基准图 ' + anchor.id + ' 没传上去，这一轮不带：' + String((error && error.message) || error), { level: 'warn' });
        anchor = null;
      }
    }
    // 编辑只带动作里点名的参考图。fallback 到 image.spec.refs 会把上一版的 R1..R4 全塞进来，
    // 模型分不清哪张是底图，就会照着参考图重画。
    const extra = await resolveActionRefs(session, image, usableRefs(session, image, action.refs || [], deps), deps);
    refs.push(...extra.files);
    if (!refs.length) throw new Error('edit 缺少可用参考图');
    // 同时送底图和别的图时，必须说清谁是谁：不说的话模型会拿参考图当底图重画。
    if (parent && (anchor || extra.files.length)) {
      const lines = refsHaveRoles(session, extra.ids) ? describeRefs(session, extra.ids, anchor ? 3 : 2) : [];
      options.prompt = editRolesPrefix(Boolean(anchor), extra.files.length, lines) + options.prompt;
    } else if (!parent && refsHaveRoles(session, extra.ids)) {
      // 规划给了参考图的图第一轮就走这里（entry 被判成 edit、没有底图）：同样要逐张说清用途。
      options.prompt = refGuide(session, extra.ids) + options.prompt;
    }
    result = await h3.edit(config, { ...options, images: refs.slice(0, 16) });
  } else {
    // refine 点名的 refs 不能把角色基准图顶掉：修一轮之后主体就漂回原样了。
    const explicit = action.refs && action.refs.length ? action.refs : image.spec.refs || [];
    const refIds = dedupe([...explicit, ...(image.spec.characterRefs || [])]);
    const resolved = await resolveActionRefs(session, image, usableRefs(session, image, refIds, deps), deps);
    if (resolved.files.length) {
      endpoint = 'images/edits';
      let prefix = '';
      // 角色基准图是"没有底图的条件图"：不说清楚，模型会连它的浅灰背景一起照搬过来。
      if (!parent && (image.spec.characterRefs || []).length) {
        prefix +=
          '参考图只用于锁定主体的身份与外观（脸型、发型与发色、眼睛、体型比例、服装款式与配色、标志性配件），' +
          '必须在所有图里保持完全一致；不要采用参考图的背景、场景、构图、机位与画幅。\n\n';
      }
      if (refsHaveRoles(session, resolved.ids)) prefix += refGuide(session, resolved.ids);
      options.prompt = prefix + options.prompt;
      result = await h3.edit(config, { ...options, images: resolved.files.slice(0, 16) });
    } else {
      result = await h3.generate(config, options);
    }
  }

  const candidates = [];
  for (let index = 0; index < result.items.length; index += 1) {
    const item = result.items[index];
    if (item.error) {
      deps.emit(session, 'paint', image.id + ' 第 ' + (index + 1) + ' 张失败：' + item.error, { level: 'warn' });
      continue;
    }
    // roundBase 让增量编辑的候选接着上一版往上编号，避免同名文件互相覆盖。
    const id = image.id + '-r' + ((image.roundBase || 0) + image.rounds.length) + '-g' + index;
    // 先拿字节再定扩展名：接口回 JPEG 时落盘叫 .png 会让文件名说谎，
    // 也会让 /api/file 按扩展名回错的 content-type（现在两边都按字节走了）。
    const buffer = await h3.download(item.url, null);
    const file = id + extensionFor(buffer);
    const filePath = join(deps.dirs.images, file);
    await writeFile(filePath, buffer);
    candidates.push({
      id,
      path: filePath,
      file,
      size: item.size,
      requestId: result.requestId,
      revisedPrompt: item.revisedPrompt,
      parentId: parent ? parent.id : null,
      parentPath: parent ? parentImagePath(image, parent) : null,
      // 统计值在 parent.program.stats 上（programChecks 写进去的），候选对象本身没有 stats 字段。
      // 写成 parent.stats 会恒为 undefined：漂移判定永远退回绝对模式，自动配平阈值从
      // 「相对父图 ≥0.05」变成「绝对 redGain ≥1.35」，编辑把画面推红也就没人拉回来了。
      parentStats: (parent && parent.program && parent.program.stats) || action.parentStats || null,
      anchorId: anchor ? anchor.id : null,
      actionType: action.type,
      actionPrompt: action.prompt,
      round: image.rounds.length - 1,
      createdAt: Date.now(),
      buffer,
      program: {},
      checks: [],
    });
  }
  const ditMs = Date.now() - started;
  session.cost.ditImages += candidates.length;
  session.cost.ditMs += ditMs;
  session.cost.usage = mergeUsage(session.cost.usage, result.usage);
  deps.emit(session, 'paint', image.id + ' 生图返回 ' + candidates.length + ' 张 · ' + seconds(ditMs), {
    durMs: ditMs,
    requestId: result.requestId || '',
    detail: detail('DiT 输出', [
      kv('接口', endpoint),
      kv('request_id', result.requestId || '-'),
      kv('尺寸', candidates.map((candidate) => candidate.size).join('、') || '-'),
      kv('耗时', seconds(ditMs)),
      kv('token', result.usage ? result.usage.total_tokens : '-'),
      anchor ? kv('色彩基准', anchor.id + '（第 2 张图，只对照颜色）') : null,
      candidates[0] && candidates[0].revisedPrompt
        ? text('模型改写后的 prompt', candidates[0].revisedPrompt)
        : null,
    ]),
  });
  return candidates;
}

// 参考图引用只认已登记的 R 编号（换成会话目录里的文件，上传后以 mm_file:// 交给接口），
// 以及已经是接口格式的 mm_file:// / data:image。其余一律返回空串，由调用方跳过并告警。
// refs 来自 Agent 的回复，是不可信输入：以前不认识的字符串会原样当成本地路径，
// 于是 uploadReference 会把那个本机文件读出来上传给接口。
// http(s) 地址也不再原样交给接口：要用的地址在上游已经下载、校验、登记成 R 编号了，
// 走到这里还是地址的，就是没经过校验的（真机 20261112-8a442a：编辑节点编了一个 404 的地址，
// 接口取不到，同一个请求连败 6 轮）。
function resolveRefPath(session, ref) {
  if (typeof ref !== 'string' || !ref) return '';
  if (/^(mm_file:\/\/|data:image\/)/i.test(ref)) return ref;
  const found = session.refs.find((item) => item.id === ref.toUpperCase());
  return found ? found.path : '';
}

// 把一组引用解析成接口能用的参考图；不认识的跳过并在时间线上说一句。
async function resolveActionRefs(session, image, list, deps) {
  const files = [];
  const ids = [];
  for (const ref of list || []) {
    const target = resolveRefPath(session, ref);
    if (!target) {
      const remote = typeof ref === 'string' && /^https?:\/\//i.test(ref);
      deps.emit(
        session,
        'paint',
        image.id + (remote ? ' 忽略了没有下载校验过的参考图地址「' : ' 忽略了不认识的参考图引用「') + String(ref).slice(0, 60) + '」',
        { level: 'warn' },
      );
      continue;
    }
    files.push(await h3.resolveReference(deps.config, target));
    ids.push(ref);
  }
  return { files, ids };
}

// ---------------------------------------------------------------- 参考图的用途
//
// 有参考比没参考画得准，所以规划会给画面里每个找得到真实样子的东西都搜参考图（主体、道具、画风、版式、场景）。
// 参考图一多，不说清每张拿来做什么，模型就会把其中一张当底图、照搬它的构图和内容。
const REF_USE_LABELS = { subject: '主体外观参考', detail: '局部参考', style: '画风参考', layout: '版式参考', scene: '场景参考' };
const REF_USE_RULES = {
  subject: '照着它画这个东西的样子',
  detail: '照着它画这件道具、服饰或材质',
  style: '只取笔触、质感和配色，不要照搬它的内容和构图',
  layout: '只取排版、留白和各元素的位置，不要照搬上面的文字和图案',
  scene: '只取环境的样子，不要照搬它的机位和构图',
};

// 逐张写明用途。first 是这批参考图在请求里从第几张开始（前面可能还有底图和色彩基准图）。
function describeRefs(session, ids, first) {
  return (ids || []).map((id, index) => {
    const ref = (session.refs || []).find((item) => item.id === id) || (session.characterRefs || []).find((item) => item.id === id);
    const position = '第 ' + (first + index) + ' 张';
    if (!ref) return position + '是参考图';
    const what = ref.note ? '（' + shortText(String(ref.note).replace(/^你给的\s*/, ''), 24) + '）' : '';
    if ((session.characterRefs || []).some((item) => item.id === id)) return position + what + '是角色基准图，锁定主体的身份与外观';
    if (ref.origin === 'search' && REF_USE_LABELS[ref.use]) {
      return position + what + '是' + REF_USE_LABELS[ref.use] + '：' + (ref.take ? ref.take + '；' : '') + REF_USE_RULES[ref.use];
    }
    // 老会话检索来的图没记用途。
    if (ref.origin === 'search') return position + what + '是检索来的参考图';
    return position + what + '是用户给的参考图';
  });
}

// 程序排字、画图表的底图必须留白。版式参考图（真实的课本页、菜单、海报）上全是字，送进去模型就会在留白处写字。
function usableRefIds(session, image, ids) {
  if (!isOverlay(image) && !hasCharts(image)) return { keep: ids, skipped: [] };
  const keep = [];
  const skipped = [];
  for (const id of ids || []) {
    const ref = (session.refs || []).find((item) => item.id === id);
    if (ref && ref.origin === 'search' && ref.use === 'layout') skipped.push(id);
    else keep.push(id);
  }
  return { keep, skipped };
}

function usableRefs(session, image, ids, deps) {
  const { keep, skipped } = usableRefIds(session, image, ids);
  if (skipped.length && !image.layoutRefsHeld) {
    image.layoutRefsHeld = true;
    deps.emit(session, 'paint', image.id + ' 的底图要留白给程序排字或画图表，版式参考图 ' + skipped.join('、') + ' 不送进生图：上面全是字，送进去模型会在留白处写字');
  }
  return keep;
}

// 检索来的参考图都带用途；只有用户给的图时沿用原来的说法，不额外加说明。
function refsHaveRoles(session, ids) {
  return (ids || []).some((id) => {
    const ref = (session.refs || []).find((item) => item.id === id);
    return ref && ref.origin === 'search' && REF_USE_LABELS[ref.use];
  });
}

// 没有底图、只送参考图时的说明。
function refGuide(session, ids) {
  return '参考图说明（这几张都不是底图，构图、机位、画幅按后面的描述来）：' + describeRefs(session, ids, 1).join('；') + '。\n\n';
}

function findCandidate(image, id) {
  if (!id) return null;
  for (const round of image.rounds) {
    const hit = round.candidates.find((candidate) => candidate.id === id);
    if (hit) return hit;
  }
  return null;
}

// 编辑要基于哪张图。增量编辑会把轮次清空，那时只能靠 pendingAction 里带下来的 parentPath，
// 所以这里必须认 parentPath，否则原图根本不会送进模型。
function resolveParent(image, action) {
  if (!action || action.type !== 'edit') return null;
  const hit = findCandidate(image, action.parentId);
  if (hit) return hit;
  // 增量编辑会先清空 image.rounds，这里 findCandidate 必然落空，只能靠 pendingAction 带下来的统计。
  // 这个分支以前只返回 {id, path}，没有 program，编辑轮的父图统计就永远是 null。
  if (action.parentPath) {
    return {
      id: action.parentId || '',
      path: action.parentPath,
      program: action.parentStats ? { stats: action.parentStats } : null,
    };
  }
  return lastCandidate(image);
}

function lastCandidate(image) {
  for (let i = image.rounds.length - 1; i >= 0; i -= 1) {
    const round = image.rounds[i];
    if (round.candidates && round.candidates.length) return round.candidates[round.candidates.length - 1];
  }
  return null;
}

// 05 VERIFY 的程序部分：二维码替换、尺寸、色彩漂移（发红）、过度锐化、文字层是否写进 prompt。
async function programChecks(session, image, candidate, deps) {
  let decoded = null;
  let format = 'unknown';
  try {
    // 复用下载时拿到的字节，省掉一次 4K 图的磁盘读 + 解码。
    // 必须走 decodeImage（PNG/JPEG 都认），不能只认 PNG：见文件头的说明。
    const bytes = candidate.buffer || (await readFile(candidate.path));
    format = sniffFormat(bytes);
    decoded = decodeImage(bytes);
  } catch (error) {
    candidate.buffer = null;
    candidate.program = { error: '图片解码失败：' + String(error && error.message ? error.message : error) };
    candidate.checks = [{ id: 'P-decode', kind: 'hard', verify: 'program', text: '图片可正常解码', result: 'fail' }];
    return;
  }
  candidate.buffer = null;
  // 二维码排在所有实测前面：统计、预览、评审看图材料都必须基于贴好真码之后、真正要交付的那张图。
  const qr = await applyQrFix(session, image, candidate, decoded, format, deps);
  if (qr && qr.decoded) decoded = qr.decoded;
  // 图表画在码之后、字之前：图表的标题、刻度是图表自己的字，用户另外要的文字排在最上面。
  const charted = await applyChartOverlay(session, image, candidate, decoded, format, deps);
  if (charted && charted.image) decoded = charted.image;
  // 程序排字同理，排在码之后（码贴在底图上，字再排上去）。
  const typed = await applyTextOverlay(session, image, candidate, decoded, format, deps);
  if (typed && typed.image) decoded = typed.image;
  let stats = png.analyze(decoded);
  const parentStats = candidate.parentStats || null;
  const drift = png.detectDrift(stats, parentStats);
  const sharp = png.detectOverSharpen(stats, parentStats);

  candidate.program = {
    width: decoded.width,
    height: decoded.height,
    longEdge: Math.max(decoded.width, decoded.height),
    stats,
    drift,
    sharpness: sharp,
    redCast: false,
    qr: qr ? qr.summary : null,
    chart: charted ? charted.summary : null,
    text: typed ? typed.summary : null,
  };

  // 色彩只做检测，不动像素：偏红由 H-color 硬项判 fail，交给 runImage 重画。
  // 偏红不再用像素配平去救。实测 matchBalance 在「子图比父图亮」时三通道增益会一起撞到
  // clamp 下限（[0.75,0.75,0.75]），退化成整体压暗：色偏一点没修，还把用户明确要的亮度
  // 压回去（真机 20261109-691283「改成烈日当空」那一轮，luma 被压到 ×0.748）。
  // 现在程序层只负责判，判成偏红就由 runImage 打回重画一轮。
  let redCast = stats.redGain >= RED_ABS_LIMIT && (drift.cast === 'red' || stats.redGain >= RED_HARD_LIMIT);
  // 红的是主体本身（橘猫、红裙子、暖色的产品）而不是整体偏色：画面里接近中性的地方是正的，就不算偏红。
  // 真偏色时中性的地方一起发红（轻微偏色量得出来），偏得厉害时中性像素几乎没有，退回整图判定。
  const subjectRed = redCast && stats.neutralShare >= NEUTRAL_MIN_SHARE && stats.neutralRedGain < RED_ABS_LIMIT;
  if (subjectRed) redCast = false;
  // 需求要的主色就是黄、红、橙，画面又几乎没有中性色：整图均值判不了白平衡，不算偏红，交给评审看。
  const warmDesign = redCast && stats.neutralShare < NEUTRAL_MIN_SHARE && imageWarm(session, image);
  if (warmDesign) redCast = false;
  candidate.program.redCast = redCast;
  // 白纸、白底：单独量白色的地方。整图均值会被大面积的彩色内容盖过去。
  const whiteOn = wantsWhite(session, image) && stats.whiteShare >= WHITE_MIN_SHARE && Array.isArray(stats.whiteRGB);
  const whiteCast = whiteOn && stats.whiteCast >= WHITE_CAST_LIMIT;
  candidate.program.whiteCast = whiteCast ? whiteCastLabel(stats.whiteRGB) : '';

  const checks = [];
  const longEdge = candidate.program.longEdge;
  checks.push({
    id: 'P-size',
    kind: 'soft',
    verify: 'program',
    text: '输出尺寸 ' + decoded.width + 'x' + decoded.height,
    result: longEdge >= 3840 ? 'pass' : 'warn',
  });
  checks.push({
    id: 'H-color',
    kind: 'hard',
    verify: 'program',
    text: redCast
      ? drift.label + '：相对父图 +' + drift.strength + '，绝对 redGain ' + stats.redGain + ' ≥ ' + RED_ABS_LIMIT + '，判为偏红'
      : subjectRed
        ? '主体本身偏红，中性区域白平衡正常（整图 redGain ' + stats.redGain + '，中性区域 ' + stats.neutralRedGain + '）'
        : warmDesign
          ? '需求要的主色是黄、红、橙，画面几乎没有中性色（' + Math.round(stats.neutralShare * 1000) / 10 + '%），程序判不了白平衡，交给评审看（整图 redGain ' + stats.redGain + '）'
          : '整体白平衡中性（redGain ' + stats.redGain + '）',
    result: redCast ? 'fail' : 'pass',
  });
  if (whiteOn) {
    const rgb = stats.whiteRGB.map((value) => Math.round(value)).join(',');
    checks.push({
      id: 'H-white',
      kind: 'hard',
      verify: 'program',
      text: whiteCast
        ? '白色的纸面或背景' + candidate.program.whiteCast + '：实测 RGB (' + rgb + ')，通道差 ' + stats.whiteCast + ' 级 ≥ ' + WHITE_CAST_LIMIT
        : '白色的纸面或背景是中性的白：实测 RGB (' + rgb + ')，通道差 ' + stats.whiteCast + ' 级',
      result: whiteCast ? 'fail' : 'pass',
    });
  }
  // 偏冷不自动打回：冷调题材很常见，交给评审表态就够了。
  if (!redCast && drift.cast === 'blue') {
    checks.push({ id: 'P-cast', kind: 'soft', verify: 'program', text: drift.label + '（交评审判断，不自动打回）', result: 'warn' });
  }
  if (sharp.overSharpened) {
    checks.push({
      id: 'P-sharp',
      kind: 'soft',
      verify: 'program',
      text: '相对父图锐度 ' + sharp.ratio + '×，疑似过度锐化',
      result: 'warn',
    });
  }
  // 程序排字时文字本来就不进 prompt，「写进 prompt」这项不适用；改由排字结果给 T 项和 H-text 定结论。
  if (typed) {
    const ok = typed.summary.status === 'overlay';
    const why = ok ? '' : textFailText(typed.summary);
    // 超出文字层上限、没排进去的段落：重画也排不上，不判 fail（免得白白重画），T 项照实写「拿不准」，交付时告诉用户。
    const dropped = (image.spec.textOverlay && image.spec.textOverlay.dropped) || [];
    for (const item of image.spec.checklist.filter((entry) => /^T\d+$/.test(entry.id))) {
      const missed = ok && dropped.some((value) => item.text.includes(shortText(value, 12).replace(/….*$/, '')));
      checks.push({
        id: item.id,
        kind: item.kind,
        verify: 'program',
        text: !ok ? '文字没排进去：' + why : missed ? '其中有段落超出 ' + MAX_TEXT_LAYERS + ' 层的上限，没排进去' : '文字由程序按原文逐字排入',
        result: !ok ? 'fail' : missed ? 'uncertain' : 'pass',
      });
    }
    if (dropped.length) {
      checks.push({
        id: 'P-textdrop',
        kind: 'soft',
        verify: 'program',
        text: '文字层超过 ' + MAX_TEXT_LAYERS + ' 层，这几段没排：' + dropped.map((value) => '「' + shortText(value, 12) + '」').join(''),
        result: 'warn',
      });
    }
    checks.push({
      id: 'H-text',
      kind: 'hard',
      verify: 'program',
      text: ok
        ? '文字已排进底图留空的位置（' + typed.summary.items.map((item) => layoutSummary(item)).join('；') + '）'
        : '文字没排进去：' + why,
      result: ok ? 'pass' : 'fail',
    });
  } else {
    for (const layer of image.spec.textLayers || []) {
      const text = typeof layer === 'string' ? layer : layer && layer.text;
      if (!text) continue;
      const inPrompt = String(candidate.revisedPrompt || '') .includes(text) || String(image.spec.prompt || '').includes(text);
      checks.push({
        id: 'P-text-' + text.slice(0, 6),
        kind: 'hard',
        verify: 'program',
        text: '文字「' + text + '」已写进 prompt',
        result: inPrompt ? 'pass' : 'fail',
      });
    }
  }
  if (qr) {
    const real = qr.summary.status === 'real';
    checks.push({
      id: 'H-qr',
      kind: 'hard',
      verify: 'program',
      text: real
        ? '二维码已换成真码，从最终文件扫码实测为「' + qr.summary.items.map((item) => item.content).join('」「') + '」'
        : '二维码没换成真码：' + qrFailText(qr.summary),
      result: real ? 'pass' : 'fail',
    });
  }
  if (charted) {
    const ok = charted.summary.status === 'overlay';
    checks.push({
      id: CHART_HARD_CHECK.id,
      kind: 'hard',
      verify: 'program',
      text: ok ? '图表已按数据画入并从最终文件量回来核对（' + chartVerifyText(charted.summary) + '）' : '图表没画上：' + chartFailText(charted.summary),
      result: ok ? 'pass' : 'fail',
    });
  }
  candidate.checks = checks;
  candidate.program.stats = stats;
  deps.emit(session, 'verify', candidate.id + ' 程序实测完成 · ' + drift.label, {
    detail: detail('程序实测 · ' + candidate.id, [
      kv('尺寸', decoded.width + 'x' + decoded.height + '（长边 ' + longEdge + '）'),
      kv('色彩', drift.label + (drift.cast !== 'none' ? '（+' + drift.strength + '）' : '')),
      redCast ? kv('偏红判定', '打回重画，不做像素配平') : null,
      kv('锐度', stats.sharpness + (sharp.overSharpened ? '（相对父图 ' + sharp.ratio + '×，疑似过度锐化）' : '')),
      kv('过曝像素占比', (Number(stats.clippedRatio || 0) * 100).toFixed(2) + '%'),
      kv('通道均值', 'R ' + stats.meanR + ' / G ' + stats.meanG + ' / B ' + stats.meanB + ' · luma ' + stats.luma),
      qr ? kv('二维码', qr.summary.status === 'real' ? '已换成真码，扫码实测通过' : '没换成：' + qrFailText(qr.summary)) : null,
      typed ? kv('文字', typed.summary.status === 'overlay' ? '由程序排入（' + fontLabelOf(typed.summary) + '）' : '没排进去：' + textFailText(typed.summary)) : null,
      list(
        '校验项',
        checks.map((check) => ({ tag: check.result, text: check.id + ' · ' + check.text })),
      ),
    ]),
  });
  await prepareAssets(candidate, decoded, deps);
}

// 把候选图里模型画的占位码换成真码，并从最终文件扫码验证（qrfix.mjs）。
// 贴好的图另存为 <候选号>-qr.<扩展名>，候选的 path / file 改指向它（交付、编辑底图、分享页都用这张）；
// 原图留在磁盘上不动，排查「贴得对不对」时要对照。没有要放的内容时返回 null，什么都不做。
//
// 修码、排字一张一张排队做：每张 4K 图处理时要同时拿着原图、副本、编码缓冲（修码还有重新解码的图），峰值两三百 MB，
// 多图任务 4 张图 × 2 张候选同时做会叠到 GB 级。它们本来就是单线程的 CPU 活，排队不损失速度。
let pixelQueue = Promise.resolve();
function queuePixelWork(task) {
  const run = pixelQueue.then(task);
  pixelQueue = run.catch(() => undefined);
  return run;
}

async function applyQrFix(session, image, candidate, decoded, format, deps) {
  const contents = qrContents(image.spec);
  if (!contents.length) return null;
  const startedAt = Date.now();
  let result;
  try {
    result = await queuePixelWork(() => fixQrInImage(decoded, format, contents));
  } catch (error) {
    const message = '修码出错：' + describeError(error);
    result = {
      ok: false,
      buffer: null,
      decoded: null,
      results: contents.map((content) => ({ content, ok: false, changed: false, reason: 'error', reasonText: message })),
    };
  }
  if (result.ok && result.buffer) {
    const file = candidate.id + '-qr' + extensionFor(result.buffer);
    const path = join(deps.dirs.images, file);
    await writeFile(path, result.buffer);
    candidate.originalFile = candidate.file;
    candidate.originalPath = candidate.path;
    candidate.file = file;
    candidate.path = path;
  }
  const summary = {
    status: result.ok ? 'real' : 'failed',
    items: result.results.map((item) => ({
      content: item.content,
      ok: Boolean(item.ok),
      changed: Boolean(item.changed),
      reason: item.reason || '',
      reasonText: item.reasonText || '',
      detail: item.detail || '',
      version: item.version || 0,
      ecl: item.ecl || '',
      modules: item.modules || 0,
      modulePx: item.modulePx || 0,
      // 每个视角扫出了什么：n = 近看，f = 远看，+ 扫出正确内容，- 没扫出，x 扫出别的内容。
      views: (item.scans || [])
        .map((scan) => scan.view[0] + (scan.data === null ? '-' : scan.data === item.content ? '+' : 'x'))
        .join(''),
      source: item.source || '',
    })),
    ms: Date.now() - startedAt,
  };
  deps.emit(
    session,
    'verify',
    candidate.id + (result.ok ? ' 二维码已换成真码，扫码实测通过' : ' 二维码没换成真码：' + qrFailText(summary)),
    {
      level: result.ok ? 'info' : 'warn',
      durMs: summary.ms,
      detail: detail('二维码替换 · ' + candidate.id, [
        kv('结论', result.ok ? '通过：最终文件扫码解出的内容与要求逐字一致' : '不通过（H-qr 判 fail）'),
        ...summary.items.map((item) =>
          group('「' + item.content + '」', [
            kv('结果', item.ok ? (item.changed ? '已贴上真码' : '原图里已经是这枚真码，没有改动') : item.reasonText + (item.detail ? '（' + item.detail + '）' : '')),
            item.version ? kv('码', '版本 ' + item.version + (item.ecl ? ' · 纠错 ' + item.ecl : '') + ' · ' + item.modules + '×' + item.modules + ' 模块 · 每模块约 ' + item.modulePx + 'px') : null,
            item.views ? kv('扫码视角', item.views + '（n 近看 / f 远看，+ 解出正确内容）') : null,
          ]),
        ),
        result.ok && result.buffer ? kv('文件', candidate.file + '（原图 ' + candidate.originalFile + ' 保留）') : null,
      ]),
    },
  );
  return { summary, decoded: result.ok ? result.decoded : null };
}

function qrFailText(summary) {
  const failed = ((summary && summary.items) || []).filter((item) => !item.ok);
  if (!failed.length) return '未知原因';
  return failed.map((item) => item.reasonText + (item.detail ? '（' + item.detail + '）' : '')).join('；');
}

// 程序画图表：在候选（留出空白面板的底图）上按数据把图表画进去，再从最终文件量回来核对（chart.mjs）。
// 画好的图另存为 <候选号>-chart.<扩展名>，候选的 path / file 改指向它；不带图表的底图记在 basePath 上，
// 之后改数、在这张图上编辑都从它开始。和修码、排字一样排队做。
async function applyChartOverlay(session, image, candidate, decoded, format, deps) {
  const charts = imageCharts(image);
  if (!charts.length) return null;
  const startedAt = Date.now();
  let result;
  try {
    result = await queuePixelWork(() => overlayCharts(decoded, format, charts));
  } catch (error) {
    const message = '画图表出错：' + describeError(error);
    result = { ok: false, buffer: null, image: null, results: charts.map((chart) => ({ type: chart.type, title: chart.title, ok: false, reason: 'error', reasonText: message })) };
  }
  const basePath = candidate.path;
  const baseFile = candidate.file;
  if (result.ok && result.buffer) {
    const file = candidate.id + '-chart' + extensionFor(result.buffer);
    const path = join(deps.dirs.images, file);
    await writeFile(path, result.buffer);
    if (!candidate.originalFile) {
      candidate.originalFile = baseFile;
      candidate.originalPath = basePath;
    }
    if (!candidate.baseFile) {
      candidate.baseFile = baseFile;
      candidate.basePath = basePath;
    }
    candidate.file = file;
    candidate.path = path;
  }
  const summary = {
    status: result.ok ? 'overlay' : 'failed',
    items: (result.results || []).map((item) => ({
      type: item.type || '',
      title: item.title || '',
      ok: Boolean(item.ok),
      reason: item.reason || '',
      reasonText: item.reasonText || '',
      detail: item.detail || '',
      font: item.font || '',
      size: item.size || 0,
      box: item.box || null,
      planned: item.planned || null,
      blank: item.blank || null,
      coverage: item.coverage || 0,
      scale: item.scale || null,
      labelsDropped: Boolean(item.labelsDropped),
      warning: item.warning || '',
      verify: item.verify
        ? { ok: Boolean(item.verify.ok), note: item.verify.note || '', checked: item.verify.checked || 0, maxErrorPx: item.verify.maxErrorPx, tolerancePx: item.verify.tolerancePx }
        : null,
    })),
    ms: Date.now() - startedAt,
  };
  deps.emit(
    session,
    'verify',
    candidate.id + (result.ok ? ' 图表已由程序按数据画入，量回来核对通过' : ' 图表没画上：' + chartFailText(summary)),
    {
      level: result.ok ? 'info' : 'warn',
      durMs: summary.ms,
      detail: detail('程序画图表 · ' + candidate.id, [
        kv('结论', result.ok ? '通过：坐标轴、刻度、数值和比例从最终文件量回来都对得上' : '不通过（H-chart 判 fail）'),
        ...summary.items.map((item, index) =>
          group('第 ' + (index + 1) + ' 张' + (CHART_TYPES[item.type] || '图表') + (item.title ? '「' + item.title + '」' : ''), [
            kv('结果', item.ok ? '已画入' + (item.size ? '，字高约 ' + item.size + 'px' : '') : item.reasonText + (item.detail ? '（' + item.detail + '）' : '')),
            item.verify ? kv('核对', item.verify.note) : null,
            item.scale ? kv('数值轴', item.scale.min + ' 到 ' + item.scale.max + '，每格 ' + item.scale.step) : null,
            item.coverage ? kv('留空', '规划位置有 ' + Math.round(item.coverage * 100) + '% 是空白') : null,
            item.labelsDropped ? kv('标注', '数值太密，没有逐个标注') : null,
            item.warning ? kv('提醒', item.warning) : null,
          ]),
        ),
        result.ok && result.buffer ? kv('文件', candidate.file + '（不带图表的底图 ' + baseFile + ' 保留）') : null,
      ]),
    },
  );
  return { summary, image: result.ok ? result.image : null };
}

// 程序排字：在候选（不带字的底图）上找到留空的位置，把文字按原文排进去（textoverlay.mjs）。
// 排好的图另存为 <候选号>-text.<扩展名>，候选的 path / file 改指向它（交付、评审都用这张）；
// 不带字的底图记在 basePath 上：之后在这张图上编辑、改字，都从它开始，不能从排好字的图开始。
// 和修码一样排队做，4K 图上排字也要同时拿着原图和副本。
async function applyTextOverlay(session, image, candidate, decoded, format, deps) {
  if (!isOverlay(image)) return null;
  const layers = overlayLayers(image);
  const startedAt = Date.now();
  let result;
  try {
    result = await queuePixelWork(() => overlayText(decoded, format, layers));
  } catch (error) {
    const message = '排字出错：' + describeError(error);
    result = { ok: false, buffer: null, image: null, results: layers.map((layer) => ({ text: layer.text, ok: false, reason: 'error', reasonText: message })) };
  }
  const basePath = candidate.path;
  const baseFile = candidate.file;
  if (result.ok && result.buffer) {
    const file = candidate.id + '-text' + extensionFor(result.buffer);
    const path = join(deps.dirs.images, file);
    await writeFile(path, result.buffer);
    if (!candidate.originalFile) {
      candidate.originalFile = baseFile;
      candidate.originalPath = basePath;
    }
    // 图表先画过的话，底图已经记成画图表之前的那张，不能改指向带图表的这张。
    if (!candidate.baseFile) {
      candidate.baseFile = baseFile;
      candidate.basePath = basePath;
    }
    candidate.file = file;
    candidate.path = path;
  }
  const summary = {
    status: result.ok ? 'overlay' : 'failed',
    items: (result.results || []).map((item) => ({
      text: item.text,
      ok: Boolean(item.ok),
      reason: item.reason || '',
      reasonText: item.reasonText || '',
      detail: item.detail || '',
      font: item.font || '',
      kind: item.kind || '',
      direction: item.direction || '',
      punctuation: item.punctuation || '',
      size: item.size || 0,
      rows: item.rows || 0,
      cols: item.cols || 0,
      lines: item.lines || 0,
      chars: item.chars || 0,
      dropped: item.dropped || 0,
      substituted: item.substituted || '',
      color: item.color || '',
      autoColor: Boolean(item.autoColor),
      box: item.box || null,
      planned: item.planned || null,
      blank: item.blank || null,
      coverage: item.coverage || 0,
      role: item.role || '',
      unified: Boolean(item.unified),
      indent: item.indent || 0,
      superscripts: item.superscripts || 0,
      rule: Boolean(item.rule),
      moved: item.moved || 0,
      ...(item.part ? { part: item.part } : {}),
    })),
    ms: Date.now() - startedAt,
  };
  deps.emit(
    session,
    'verify',
    candidate.id + (result.ok ? ' 文字已由程序排入（' + fontLabelOf(summary) + '）' : ' 字没排上：' + textFailText(summary)),
    {
      level: result.ok ? 'info' : 'warn',
      durMs: summary.ms,
      detail: detail('程序排字 · ' + candidate.id, [
        kv('结论', result.ok ? '通过：文字按原文逐字排进底图留空的位置' : '不通过（H-text 判 fail）'),
        ...summary.items.map((item, index) =>
          group('第 ' + (index + 1) + ' 段「' + shortText(item.text, 12) + '」', [
            kv('结果', item.ok ? layoutSummary(item) : item.reasonText + (item.detail ? '（' + item.detail + '）' : '')),
            item.font ? kv('字体', item.font + (item.substituted ? '（缺字用别的字体补：' + item.substituted + '）' : '')) : null,
            item.ok && item.color ? kv('颜色', item.color + (item.autoColor ? '（规划给的颜色和底色反差不够，自动换的）' : '')) : null,
            item.ok && item.dropped ? kv('标点', '按书法习惯不写标点，省去 ' + item.dropped + ' 个') : null,
            item.coverage ? kv('留空', '规划位置有 ' + Math.round(item.coverage * 100) + '% 是空白') : null,
          ]),
        ),
        result.ok && result.buffer ? kv('文件', candidate.file + '（不带字的底图 ' + baseFile + ' 保留）') : null,
      ]),
    },
  );
  return { summary, image: result.ok ? result.image : null };
}

// 一次解码同时产出页面预览和评审看图材料，避免对同一张 4K 图解码两遍。
async function prepareAssets(candidate, decoded, deps) {
  try {
    const small = png.downsample(decoded, DEFAULTS.previewEdge);
    const previewPath = join(deps.dirs.previews, candidate.id + '.png');
    await writeFile(previewPath, png.encodePng(small, { level: 3 }));
    candidate.preview = previewPath;
    candidate.previewFile = candidate.id + '.png';
  } catch {
    candidate.preview = null;
  }
  try {
    await mkdir(deps.dirs.sheets, { recursive: true });
    let canvas = review.renderCandidateSheet(decoded);
    if (Math.max(canvas.width, canvas.height) > DEFAULTS.sheetMaxEdge) {
      canvas = png.downsample(canvas, DEFAULTS.sheetMaxEdge);
    }
    const sheetPath = join(deps.dirs.sheets, candidate.id + '-sheet.png');
    await writeFile(sheetPath, png.encodePng(canvas, { level: 6 }));
    candidate.sheet = sheetPath;
  } catch {
    candidate.sheet = null;
  }
}

// ---------------------------------------------------------------- 评审 / 修正 / 选优

// 评审输出的 extra_fails 解析。放在模块级是为了让 hard 合并块只依赖 rawExtra 一个变量，
// 沙箱测试能整块抽出来跑。
function extraFailText(item) {
  if (typeof item === 'string') return item.trim();
  if (!item || typeof item !== 'object') return '';
  return String(item.text || item.note || '').trim();
}

// 取属于某个候选的清单外问题。candidateId 缺失或写错时按「不指定候选」处理，
// 挂到所有候选上——评审确实看到了问题，只是没说是哪张，保守判本轮不通过再修正。
function extraFailsFor(rawExtra, candidateId) {
  const out = [];
  for (const item of Array.isArray(rawExtra) ? rawExtra : []) {
    const text = extraFailText(item);
    if (!text) continue;
    const cid = item && typeof item === 'object' ? String(item.candidateId || '') : '';
    if (cid && cid !== candidateId) continue;
    if (out.indexOf(text) < 0) out.push(text);
  }
  return out;
}

async function judgeNode(session, image, record, deps) {
  const candidates = record.candidates;
  const refSheet = await ensureRefSheet(session, deps);
  const level = difficultyOf(image);
  const budget = toolBudget('judge', {
    needs: [
      { count: candidates.length, what: '每个候选的看图材料' },
      { count: refSheet ? 1 : 0, what: '参考图材料' },
    ],
    difficulty: level.level,
    hits: hitsOf(image, 'judge'),
  });

  // 评审只看 harness 备好的"看图材料"，一张图就把整体、曝光和局部全看完了。
  const lines = candidates.map((candidate, index) => {
    const program = candidate.program || {};
    const parts = [
      '候选 ' + (index + 1) + '（candidateId = ' + candidate.id + '）',
      '  看图材料：' + (candidate.sheet || candidate.path),
    ];
    if (program.stats) {
      parts.push(
        '  程序实测：尺寸 ' + program.width + 'x' + program.height +
          '；色彩 ' + (program.drift ? program.drift.label : '正常') +
          (program.redCast ? '（程序判定偏红）' : '') +
          '；锐度 ' + program.stats.sharpness +
          '；过曝像素占比 ' + (program.stats.clippedRatio !== undefined ? program.stats.clippedRatio : '未知') +
          (program.qr
            ? '；二维码 ' + (program.qr.status === 'real' ? '已由程序换成真码并扫码验证通过' : '没换成真码（' + qrFailText(program.qr) + '）')
            : '') +
          (program.chart
            ? '；图表 ' + (program.chart.status === 'overlay' ? '已由程序按数据画入并量回来核对通过' : '没画上（' + chartFailText(program.chart) + '）')
            : '') +
          (program.text
            ? '；文字 ' + (program.text.status === 'overlay' ? '已由程序按原文逐字排入（' + fontLabelOf(program.text) + '）' : '没排进去（' + textFailText(program.text) + '）')
            : ''),
      );
    } else if (program.error) {
      parts.push('  程序实测：' + program.error);
    }
    return parts.join('\n');
  });

  const checklist = image.spec.checklist
    .map((item) => item.id + ' [' + item.kind + '] ' + item.text + (item.verify === 'program' ? '（程序已验）' : ''))
    .join('\n');
  const history = image.rounds
    .map((round) => '第' + (round.index + 1) + '轮 ' + describeAction(round.action) + ' -> ' + (round.verdict ? round.verdict.note : round.error || '进行中'))
    .join('\n');

  const instruction = [
    '你是H3-Image-Executor 的评审节点。看图材料已经由程序准备好，你只要打开图、看、给结论。',
    '',
    '用户原话（最高优先级，最终按原话整体判断，不要被清单牵着走）：',
    session.instruction,
    '',
    '本轮候选（每个候选对应一张"看图材料"图，只 read 这张材料图，不要再去打开原始大图）：',
    lines.join('\n'),
    '',
    '看图材料的版式：',
    review.CANDIDATE_SHEET_LAYOUT,
    '',
    '参考图材料（判断"是不是同一个人 / 同一台车 / 同一个 logo"时对照这一张就够）：',
    refSheet
      ? '  ' + refSheet + '\n  编号与清单里的 R1、R2… 一一对应。\n  原始文件：' + session.refs.map((ref) => ref.id + ' -> ' + ref.path).join('；')
      : '（无参考图）',
    '',
    '验收清单：',
    checklist,
    '',
    '判定规则（严格照做，不要加戏）：',
    '1. hard 项是「要求」不是「缺陷」：把每条 hard 拆成限定词逐个核对，缺一个限定词就是 fail。',
    '   判 fail 的门槛是"你能说出缺了什么"，不是"你能指出一处破损"。要求的东西没入画、角度不对、人物不像，都算明确的 fail。',
    '   反例：要求「机位在车外左侧约45度，透过前挡风玻璃看到两人」，而画面是正侧贴近侧窗拍的——',
    '   只满足"车外"和"看到两人"，机位不是45度、也不是透过前挡风玻璃，必须判 fail，不能因为"大体符合"放行。',
    '   note 必须写清楚：缺了哪个限定词、在第几块能看出来（引用编号，如"第 1 块"）。',
    '2. 构图、机位、角度、景别、主体在画幅里的位置，只能看第 1 块整体预览判断。',
    '   局部放大块（4-7）看不出构图，不要拿它们下构图结论。',
    '3. 用户原话里点名的机位/角度/景别，逐字对照第 1 块；对不上就是 fail，这条优先于任何"看起来还行"的印象。',
    '4. 只有在"图里根本看不清、被遮挡、分辨率不够、缺参考图，无法判断"时才用 uncertain。',
    '   看得清但不满足 → 必须 fail，不许用 uncertain 兜底。uncertain 记 pass，别拿它当免死金牌。',
    '   仍然不要为了保险把真拿不准的写成 fail——错杀一次就要重做一整轮，代价远大于放过。',
    '5. soft 项只影响 quality 分（0-10），不影响通过与否。',
    '6. 禁止写脚本、裁图、拼图、量像素、跑统计、联网搜索。尺寸、色彩、锐度、过曝程序都测过了，直接采信，不要推翻。',
    '7. 工具调用上限 ' + budget.limit + ' 次：每个候选的材料图 + 参考图材料，看完立刻给结论。',
    '8. 你看不到送进模型的 prompt，只能看图。',
    '9. 先把所有候选判完，再决定 next。',
    '10. note 不超过 30 字，summary 不超过 40 字。',
    '11. extra_fails 是「清单没写、但你一眼看出违背用户原话」的问题，按 hard fail 处理：',
    '    典型是姿势/手型/指法不对、动作雷同、该出现的东西没出现、人物明显不像。',
    '    每项形如 {"candidateId":"...","text":"第3格的 H 手型不是 ASL 的 H"}，写清在第几块能看出来。',
    '    硬性要求：只要你在 summary 或 note 里写了「手型不对」「姿势不准」「略偏」「雷同」「没画出来」',
    '    这类话，就必须把同一条写进 extra_fails——不许只在 summary 里吐槽完就给 pass。',
    '    反过来也确实拿不准的（看不清、分辨率不够）不要写进 extra_fails。',
    ...((image.spec.qrCodes || []).length
      ? [
          '12. 二维码：' +
            (qrContents(image.spec).length
              ? '画面里的二维码由程序换成真码，并在最终文件上扫码验证过（H-qr，程序已验）。码能不能扫、扫出什么不用你判，'
              : '这张图的二维码是装饰图案（用户没给内容），不要求能扫。') +
            '不要因为码的黑白图案和你预想的不一样判 fail；',
          '    只在码明显错位（没对齐原来的白底、压住了文字或主体）、被遮挡、缺失或放错位置时写进 extra_fails。',
        ]
      : []),
    ...(isOverlay(image)
      ? [
          ((image.spec.qrCodes || []).length ? '13' : '12') +
            '. 文字：这张图的文字是程序用字体按原文逐字排进去的（' +
            overlayLayers(image).map((layer) => (layer.direction === 'vertical' ? '竖排' : '横排') + FONT_KINDS[layer.font].label).join('、') +
            '），文字内容、字序、行列顺序程序已验（T 项、H-text），不要逐字核对，',
          '    也不要因为「是字体排的、不是手写的」判 fail：书体类条目按「看起来是不是要求的那种字」判。',
          '    你要看的是：H-notext（画面别处有没有多出来的字、伪文字、乱码）；S-textfit（字和载体融不融合）；',
          '    字压到边框或主体、写出了载体、字和载体透视明显对不上时写进 extra_fails。',
          '    字的位置有问题而底图本身没问题（压到线或色块边缘、出了载体、该在色块里却排在外面、几段挤在一起）时，',
          '    next 写 {"type":"text","candidateId":"…","text_layers":[{"index":3,"box":[左,上,右,下]}],"reason":"…"}：',
          '    程序在这张候选不带字的底图上按新位置重新排字，不重新生图，几秒钟就好。box 是 0-1 的画面比例，',
          '    只写要挪的那几段，也可以写 "align"（start / center / end）；不要改文字内容。各段的编号和位置：',
          ...candidates
            .filter((candidate) => candidate.program && candidate.program.text && candidate.program.text.status === 'overlay')
            .map((candidate) => '    ' + candidate.id + '：\n' + textInventory(image, candidate)),
          '    挪位置只能挪，拼不出字：每一层是一段完整的字，两层挪得再近也成不了一个字。用户要的字没有作为一个完整的字出现',
          '    （被拆成了偏旁和部件两块、少了字）就判 fail，并写进 extra_fails，不要用 text 去挪。',
          ...((image.spec.readingProblems || []).length
            ? [
                '    注意：规划的文字层按版面读出来，用户要的' + image.spec.readingProblems.map((item) => '「' + item.quote + '」').join('、') +
                  '读不出来（读出来是 ' + image.spec.readingProblems[0].rows.map((row) => '「' + row + '」').join(' ') + '）。',
                '    清单里涉及这几处的条目看图核对，图上读不出来就判 fail。',
              ]
            : []),
          '    底图本身有问题（没留空、构图不对、多画了东西）才写 regenerate / edit：给模型的指令里不要写任何文字内容，字之后会重新排。',
        ]
      : []),
    ...(hasCharts(image)
      ? [
          12 + ((image.spec.qrCodes || []).length ? 1 : 0) + (isOverlay(image) ? 1 : 0) +
            '. 图表：画面里的数据图表是程序按数据画进去的（' +
            imageCharts(image).map((chart) => CHART_TYPES[chart.type] + (chart.title ? '「' + chart.title + '」' : '')).join('、') +
            '），坐标轴、刻度、数值标注和比例都从最终文件量回来核对过（H-chart，程序已验），',
          '    不要核对数字、不要估柱子高矮，也不要因为「是程序画的、太规整」判 fail。',
          '    你要看的是：H-nochart（画面别处有没有模型自己画的图表、坐标轴、乱码数字）；S-chartfit（图表和画面协不协调）；',
          '    图表被遮挡、裁切、压到主体或文字时写进 extra_fails。',
          '    next 只能改画面本身：给模型的指令里不要写图表和数字，图表之后会重新画。',
        ]
      : []),
    '',
    '历史动作（判完候选后再看，只用于决定 next）：',
    history || '（首轮）',
    '',
    '只输出一个 JSON 对象，不要解释、不要 markdown 代码块：',
    '{"verdicts":[{"candidateId":"' + candidates[0].id + '","checks":[{"id":"H1","result":"pass|fail|uncertain","note":"..."}],"quality":7.5,"summary":"..."}],',
    ' "extra_fails":[{"candidateId":"' + candidates[0].id + '","text":"清单外但违背用户原话的问题"}],',
    ' "next":{"type":"' + (isOverlay(image) ? 'regenerate|edit|text|give_up' : 'regenerate|edit|give_up') + '","candidateId":"...","prompt":"给模型的中文编辑或生成指令","reason":"..."}}',
    '',
    '如果所有候选的 hard 项都通过，next 直接写 {"type":"give_up"}。',
  ].join('\n');

  const judged = await deps.agent.runJson(session, { step: 'judge', instruction, maxTools: budget.limit, budgetNote: budget.note });
  noteToolHit(image, 'judge', judged);
  const { data } = judged;
  const verdicts = Array.isArray(data.verdicts) ? data.verdicts : [];
  const hardIds = image.spec.checklist.filter((item) => item.kind === 'hard').map((item) => item.id);
  const softIds = image.spec.checklist.filter((item) => item.kind === 'soft').map((item) => item.id);

  // 评审看出来了、清单里却没写的问题（真机 20261110-5e10ae：A 图 g1 summary 写「手型几乎
  // 全是摊掌」、C 图写「H 手势不准」、E 图写「P/Q 手势雷同」，全部只写进 summary，
  // hardFailed 恒为空，于是每张图都放行）。extra_fails 就是给评审的表达渠道，按 hard fail 处理。
  const validIds = candidates.map((candidate) => candidate.id);
  const rawExtra = (Array.isArray(data.extra_fails) ? data.extra_fails : []).map((item) => {
    if (!item || typeof item !== 'object') return item;
    const cid = String(item.candidateId || '');
    // 写错的 candidateId 归一成「未指定」：否则这条问题会被静默丢掉，
    // 而它恰恰是评审真正看出来的东西——这正是这次要修的漏检。
    return cid && validIds.indexOf(cid) < 0 ? { ...item, candidateId: '' } : item;
  });

  let best = null;
  let passed = false;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    // 评审可能把候选 ID 写错或写漏，ID 对不上时按顺序兜底，避免整轮被误判为不通过。
    const verdict =
      verdicts.find((item) => item.candidateId === candidate.id) ||
      verdicts[index] ||
      { checks: [], quality: 0 };
    const results = {};
    for (const check of verdict.checks || []) results[check.id] = check;
    // 程序级 hard 项的 pass 也要并进来：H-color 是清单里的 hard，评审不会评它，
    // 只并 fail 的话 results['H-color'] 恒不存在、isPass 判 false，每张图都会被误判不通过。
    for (const check of candidate.checks || []) {
      if (check.kind !== 'hard') continue;
      if (check.result === 'fail') results[check.id] = { result: 'fail', note: check.text };
      else if (check.result === 'pass' && !results[check.id]) results[check.id] = { result: 'pass', note: check.text };
    }
    // uncertain 视为通过：评审拿不准不等于图有问题，把拿不准当失败是过度打回的主要来源。
    const isPass = (id) => results[id] && (results[id].result === 'pass' || results[id].result === 'uncertain');
    const hardPassed = hardIds.filter(isPass).length;
    // 程序层临时加的 hard 项（典型是 P-decode：图根本解不开，等于一项都没验）不在规划清单里，
    // 只按 hardIds 算就会把它漏掉——解不开的图照样标成「验证通过」交付出去。
    // 清单是规划写的，程序层的 fail 不该因为「不在清单里」就不拦。
    const programHardFailed = (candidate.checks || [])
      .filter((check) => check.kind === 'hard' && check.result === 'fail' && hardIds.indexOf(check.id) < 0)
      .map((check) => check.id);
    // 清单外的评审发现：挂成 X1、X2… 直接算 hard fail，并计入 hardTotal，
    // 这样「hard 6/6」会如实变成「hard 6/7」，事件里一眼能看出多出来的是哪一条。
    const extraForCandidate = extraFailsFor(rawExtra, candidate.id);
    const extraIds = [];
    for (const note of extraForCandidate) {
      const id = 'X' + (extraIds.length + 1);
      extraIds.push(id);
      results[id] = { result: 'fail', note };
    }
    const hardFailed = hardIds.filter((id) => !isPass(id)).concat(programHardFailed, extraIds);
    const hardUncertain = hardIds.filter((id) => results[id] && results[id].result === 'uncertain');
    const softPassed = softIds.filter((id) => results[id] && results[id].result === 'pass').length;
    candidate.verdict = {
      quality: Number(verdict.quality) || 0,
      summary: verdict.summary || '',
      checks: results,
      hardPassed,
      hardTotal: hardIds.length + extraIds.length,
      hardFailed,
      hardUncertain,
      extraFails: extraIds,
      softPassed,
      softTotal: softIds.length,
    };
    const allHard = hardIds.length > 0 && hardFailed.length === 0;
    if (allHard) passed = true;
    if (!best || candidate.verdict.hardPassed > best.verdict.hardPassed ||
      (candidate.verdict.hardPassed === best.verdict.hardPassed && candidate.verdict.quality > best.verdict.quality)) {
      best = candidate;
    }
  }

  const next = normalizeNext(data.next, candidates, image);
  return {
    passed,
    best,
    next,
    summary: {
      hardTotal: best ? best.verdict.hardTotal : hardIds.length,
      note: best
        ? 'hard ' + best.verdict.hardPassed + '/' + hardIds.length +
          (best.verdict.hardUncertain.length ? '（' + best.verdict.hardUncertain.length + ' 项拿不准但放行）' : '') +
          '，质量 ' + best.verdict.quality
        : '无有效候选',
    },
  };
}

function normalizeNext(raw, candidates, image) {
  if (!raw || !raw.type) return null;
  if (raw.type === 'give_up') return { type: 'give_up' };
  // 只重新排字：在某张候选不带字的底图上按新位置重排，不调生图接口。只认排过字、有底图的候选。
  if (raw.type === 'text') {
    if (!isOverlay(image)) return null;
    const typed = (candidates || []).filter((c) => c.basePath && c.program && c.program.text && c.program.text.status === 'overlay');
    const target = typed.find((c) => c.id === raw.candidateId) || typed[0];
    const textPatches = normalizeLayoutPatches(raw.text_layers, overlayLayers(image).length);
    if (!target || !textPatches.length) return null;
    return { type: 'text', parentId: target.id, textPatches, prompt: '', reason: raw.reason || '' };
  }
  const prompt = String(raw.prompt || '').trim();
  if (!prompt) return null;
  if (raw.type === 'edit') {
    const parentId = raw.candidateId && candidates.some((c) => c.id === raw.candidateId)
      ? raw.candidateId
      : candidates.length
        ? candidates[0].id
        : null;
    return { type: 'edit', prompt, parentId, reason: raw.reason || '' };
  }
  return { type: 'generate', prompt, refs: image.spec.refs, parentId: null, reason: raw.reason || '' };
}

// ---------------------------------------------------------------- 只重新排字（修正轮）
//
// 程序排字的图，字的位置不对（压线、出界、该在色块里却在外面）是排字的问题，不是底图的问题：
// 以前评审只能选重画或改图，重画多少轮字还是排在同样的地方（真机 20261116-06a562，6 轮 12 张候选没修好）。
// 现在评审可以只改各段的位置，程序在同一张底图上重新排，不调生图接口。

// 评审写的挪动：只认位置和对齐，不认文字内容（内容是用户给的，评审不能改）。
function normalizeLayoutPatches(raw, count) {
  const out = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!item || typeof item !== 'object') continue;
    const index = Number(item.index);
    if (!Number.isInteger(index) || index < 0 || index >= count) continue;
    const patch = { index };
    if (Array.isArray(item.box) && item.box.length === 4 && item.box.every((value) => Number.isFinite(Number(value)))) {
      let box = item.box.map(Number);
      if (box.some((value) => value > 1.5)) box = box.map((value) => value / 100);
      box = box.map((value) => Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000);
      if (box[2] > box[0] && box[3] > box[1]) patch.box = box;
    }
    if (TEXT_ALIGNS.has(item.align)) patch.align = item.align;
    if (patch.box || patch.align) out.push(patch);
  }
  return out;
}

function applyLayoutPatches(session, image, patches) {
  const overlay = image.spec.textOverlay;
  if (!overlay) return;
  const layers = overlay.layers.slice();
  for (const patch of patches || []) {
    if (!layers[patch.index]) continue;
    layers[patch.index] = { ...layers[patch.index], ...(patch.box ? { box: patch.box } : {}), ...(patch.align ? { align: patch.align } : {}) };
  }
  image.spec.textOverlay = { ...overlay, layers, planned: true };
  // 留白的说法跟着新位置走：之后要是还得重画底图，模型留空的地方和程序排字的地方对得上。
  image.spec.basePrompt = composeBasePrompt(image.spec, session.instruction);
}

// 每段字的规划位置和这张候选上实际排的位置，给评审、修正节点挪字时参考。
function textInventory(image, candidate) {
  const items = (candidate && candidate.program && candidate.program.text && candidate.program.text.items) || [];
  return overlayLayers(image)
    .map((layer, index) => {
      const placed = items[index];
      // 带上实测字高和分色结果：「结果字明显放大」「偏旁是橙色」这类条目，评审能对着数字判，不只凭眼睛估。
      const where = placed
        ? placed.ok && placed.box
          ? '实际排在 ' + JSON.stringify(placed.box) + '，字高 ' + placed.size + 'px' + (placed.lines > 1 ? '，' + placed.lines + ' 行' : '') + partText(placed.part)
          : '没排上（' + (placed.reasonText || '') + '）'
        : '';
      return '  ' + index + '「' + shortText(layer.text, 16) + '」' + (layer.role ? ' ' + layer.role : '') + ' 规划 ' + JSON.stringify(layer.box) + (where ? '，' + where : '');
    })
    .join('\n');
}

const PART_SIDE_TEXT = { left: '左边', right: '右边', top: '上边', bottom: '下边' };

function partText(part) {
  if (!part) return '';
  if (part.ok) return '，每个字' + PART_SIDE_TEXT[part.side] + '的部件用 ' + part.color + '（程序分色）' + (part.note ? '：' + part.note : '');
  return '，部件分色没做成' + (part.note ? '：' + part.note : '');
}

// 修正轮里的「只重新排字」：拿指定候选不带字的底图做一张新候选，排字留给 programChecks（用改过的位置）。
async function retypesetRound(session, image, action, deps) {
  const parent = findCandidate(image, action.parentId);
  const basePath = parent && parent.basePath;
  if (!basePath) throw new Error('找不到 ' + (action.parentId || '这张候选') + ' 不带字的底图');
  applyLayoutPatches(session, image, action.textPatches);
  const buffer = await readFile(basePath);
  const id = image.id + '-r' + ((image.roundBase || 0) + image.rounds.length) + '-g0';
  return [
    {
      id,
      path: basePath,
      file: basename(basePath),
      size: parent.size,
      requestId: parent.requestId,
      revisedPrompt: parent.revisedPrompt,
      parentId: parent.id,
      parentPath: basePath,
      parentStats: (parent.program && parent.program.stats) || null,
      actionType: 'text',
      actionPrompt: parent.actionPrompt || '',
      round: image.rounds.length - 1,
      createdAt: Date.now(),
      buffer,
      program: {},
      checks: [],
    },
  ];
}

async function refineNode(session, image, record, verdict, deps, forceChange) {
  const budget = toolBudget('refine', {
    needs: [{ count: (record.candidates || []).length, what: '最新候选' }],
    difficulty: difficultyOf(image).level,
    hits: hitsOf(image, 'refine'),
  });
  const history = image.rounds
    .map((round) => '第' + (round.index + 1) + '轮 ' + describeAction(round.action) + ' -> ' + (round.verdict ? round.verdict.note : ''))
    .join('\n');
  const failed = verdict.best
    ? verdict.best.verdict.hardFailed.map((id) => {
        const item = image.spec.checklist.find((entry) => entry.id === id);
        const detail = verdict.best.verdict.checks[id];
        // X 开头的是评审发现的清单外问题，清单里查不到，标清楚来源，
        // 否则修正节点看到的是「X1 ：xxx」这种半截句子。
        const label = item ? item.text : '评审发现的清单外问题';
        return id + ' ' + label + '：' + (detail && detail.note ? detail.note : '未通过');
      })
    : [];
  const instruction = [
    '你是H3-Image-Executor 的修正节点。看之前的动作和各轮结果，给出一个能真正改善的修正动作。',
    '',
    '用户原话：',
    session.instruction,
    '',
    '当前 prompt：',
    promptFor(image),
    '',
    ...(isOverlay(image)
      ? [
          '这张图的文字由程序后贴：模型只画不带字的底图，文字之后由程序按原文排进「文字留白」写的那块区域。',
          '给模型的指令只描述画面本身，不要写任何文字内容，也不要让模型在留白区域画东西。',
          '没通过的原因是字的位置（压线、出界、该在色块里却在外面、挤在一起）而底图本身没问题时，不要重画：',
          '写 {"type":"text","candidateId":"…","text_layers":[{"index":3,"box":[左,上,右,下]}],"reason":"…"}，',
          '程序在这张候选不带字的底图上按新位置重新排字，不调生图接口。挪位置拼不出字：两层挪得再近也成不了一个字。各段的编号和位置：',
          ...(record.candidates || [])
            .filter((candidate) => candidate.program && candidate.program.text && candidate.program.text.status === 'overlay')
            .map((candidate) => candidate.id + '：\n' + textInventory(image, candidate)),
          '',
        ]
      : []),
    '最新候选（本地路径，可以 read 打开看）：',
    (record.candidates || []).map((candidate) => candidate.id + ' -> ' + candidate.path).join('\n') || '（无）',
    '',
    '没通过的 hard 项：',
    failed.join('\n') || '（无）',
    '',
    '历史动作与结果：',
    history || '（首轮）',
    '',
    forceChange
      ? '注意：连续几轮没有改善，必须换一种做法（regenerate 重新生成 / edit 在某个候选上局部编辑 / give_up 放弃）。'
      : '优先在最能救的候选上做局部编辑；构图本身不对才重新生成。',
    '经验：不带贴回框的全图 edit 每次都会累积一点偏色和过度锐化，同一条链上不要超过 2 次。',
    '工具调用上限 ' + budget.limit + ' 次：只 read 要看的候选，看完立刻给结论。',
    '',
    '只输出一个 JSON 对象：',
    '{"type":"' + (isOverlay(image) ? 'regenerate|edit|text|give_up' : 'regenerate|edit|give_up') + '","candidateId":"...","prompt":"给模型的具体指令","reason":"..."}',
  ].join('\n');

  const startedAt = Date.now();
  const refined = await deps.agent.runJson(session, { step: 'refine', instruction, maxTools: budget.limit, budgetNote: budget.note });
  noteToolHit(image, 'refine', refined);
  const { data } = refined;
  const next = normalizeNext(data, record.candidates || [], image);
  deps.emit(session, 'refine', image.id + ' 修正方案：' + (next ? describeAction(next) : '放弃本轮'), {
    durMs: Date.now() - startedAt,
    detail: detail('修正节点输出', [
      kv('动作', next ? next.type : 'give_up'),
      kv('目标候选', (next && next.parentId) || '-'),
      kv('强制换改法', forceChange ? '是' : '否'),
      text('理由', (next && next.reason) || ''),
      text('给模型的指令', (next && next.prompt) || ''),
      list('没通过的 hard 项', failed),
    ]),
  });
  return next;
}

async function selectNode(session, image, deps) {
  const pool = [];
  for (const round of image.rounds) {
    // 每轮挑一张：没评审过的（评审没跑成）按程序校验结果排，见 rankCandidates。
    const best = rankCandidates((round.candidates || []).filter((candidate) => candidate && candidate.path))[0];
    if (best) pool.push(best);
  }
  if (!pool.length) {
    image.status = 'failed';
    const why = lastFailReason(image);
    image.failReason = why;
    deps.emit(session, 'select', image.id + ' 没有任何可用候选' + (why ? '：' + why : ''), {
      level: 'error',
      detail: detail('没有可用候选', [
        kv('图', image.id + ' · ' + image.title),
        kv('轮次', image.rounds.length),
        why ? kv('最后一次报错', why) : kv('最后一次报错', '无报错，候选全部未通过程序校验'),
      ]),
    });
    return;
  }
  if (pool.length === 1) {
    image.chosen = pool[0];
    image.status = 'unpassed';
    image.chosenReason = '只有一轮候选，按验收分数选出';
    deps.emit(session, 'select', image.id + ' 只有一轮候选，直接交付 ' + pool[0].id, {
      detail: detail('选优', [
        kv('候选池', pool.map((candidate) => candidate.id).join('、')),
        kv('选中', pool[0].id),
        text('理由', image.chosenReason),
      ]),
    });
    return;
  }
  // 先按分数取前 4 张再打乱顺序：以前是先打乱再截 4 张，轮次多的时候最好的那张可能根本没进对比图。
  const shuffled = rankCandidates(pool).slice(0, 4).sort(() => Math.random() - 0.5);
  // 选优同样只看一张并排对比图：顺序打乱、不给分数，避免评审被历史结论带偏。
  // 编号按实际拼进图里的顺序重排：有一张解不开时，图上的编号和「编号对应」必须还是同一套。
  let sheetPath = '';
  let shown = shuffled;
  try {
    await mkdir(deps.dirs.sheets, { recursive: true });
    const built = await review.buildGridSheet(
      shuffled.map((candidate) => ({ path: candidate.path, label: '' })),
      join(deps.dirs.sheets, image.id + '-select-sheet.png'),
      { perRow: Math.min(shuffled.length, 4), renumber: true },
    );
    if (built.sheet) {
      sheetPath = built.sheet;
      shown = built.items.map((item) => shuffled[item.index]);
    }
  } catch {
    sheetPath = '';
    shown = shuffled;
  }
  // 有对比图时只看这一张；拼不出来就得逐张打开。
  const budget = toolBudget('select', {
    needs: [sheetPath ? { count: 1, what: '并排对比图' } : { count: shown.length, what: '逐张打开候选' }],
    difficulty: difficultyOf(image).level,
    hits: hitsOf(image, 'select'),
  });
  const instruction = [
    '你是H3-Image-Executor 的选优节点。下面几张图来自不同轮次，历史评分不完全可比，请只看图并排对比后选一张交付。',
    '',
    '用户原话：',
    session.instruction,
    '',
    sheetPath
      ? '对比图（只 read 这一张，从左到右、从上到下依次编号，左上角有编号标签）：\n  ' + sheetPath +
        '\n  编号对应：' + shown.map((candidate, index) => (index + 1) + '=' + candidate.id).join('，')
      : '候选（本地绝对路径，必须用 read 逐张打开看）：\n' +
        shown.map((candidate, index) => '候选' + (index + 1) + ' -> ' + candidate.path).join('\n'),
    '',
    '不要写脚本、不要裁图、不要量像素。看图直接选，按用户原话判断哪张最合适，写明理由。',
    '工具调用上限 ' + budget.limit + ' 次。只输出 JSON：',
    '{"choice":1,"reason":"..."}',
  ].join('\n');
  try {
    const picked = await deps.agent.runJson(session, { step: 'select', instruction, maxTools: budget.limit, budgetNote: budget.note });
    noteToolHit(image, 'select', picked);
    const { data } = picked;
    const index = Math.max(0, Math.min(shown.length - 1, Number(data.choice || 1) - 1));
    image.chosen = shown[index];
    image.chosenReason = data.reason || '';
  } catch {
    // 选优回合没跑成（比如模型服务这时也在报错）：按分数取最好的一张，不能取打乱后的第一张。
    image.chosen = rankCandidates(shown)[0];
    image.chosenReason = '选优节点失败，按验收分数回退';
  }
  image.status = 'unpassed';
  deps.emit(session, 'select', image.id + ' 选优交付：' + image.chosen.id + '（' + image.chosenReason + '）', {
    detail: detail('选优', [
      kv('候选池', pool.map((candidate) => candidate.id).join('、')),
      kv('送进对比图的顺序', shown.map((candidate, index) => (index + 1) + '=' + candidate.id).join('，')),
      kv('选中', image.chosen.id),
      text('理由', image.chosenReason),
      list(
        '各候选验收分',
        pool.map((candidate) => ({
          text:
            candidate.id +
            ' · hard ' +
            ((candidate.verdict && candidate.verdict.hardPassed) || 0) +
            '/' +
            ((candidate.verdict && candidate.verdict.hardTotal) || 0) +
            ' · 质量 ' +
            ((candidate.verdict && candidate.verdict.quality) || 0),
        })),
      ),
    ]),
  });
}

// ---------------------------------------------------------------- 08 增量编辑

// 某一轮生图全部失败时会交付 0 张图，image.chosen 变 null、image.rounds 也被清成空候选，
// 下一轮编辑的三条找底图路径（findCandidate / chosen / lastCandidate）就全落空了——
// 但上一版交付图其实还好好躺在 deliver/vN/ 里。从历史轮次的交付记录把它捞回来，
// 编辑链才不会被一次失败打断（实测「换背景」那一轮就是这么退化成重新生成的）。
function lastDelivered(session, image, deps) {
  const turns = session.turns || [];
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const delivery = turns[i] && turns[i].delivery;
    if (!delivery || !Array.isArray(delivery.items)) continue;
    const item = delivery.items.find((one) => one && one.id === image.id && one.file);
    if (!item) continue;
    return {
      id: item.candidateId || image.id,
      path: join(deps.dirs.deliver, item.file),
      preview: item.previewFile ? join(deps.dirs.deliver, item.previewFile) : null,
      size: item.size || '',
      program: item.program || null,
      // 不带字的底图（程序排字时）：之后改字、改画面都从它开始。
      basePath: item.baseFile && /^[A-Za-z0-9._-]+$/.test(item.baseFile) ? join(deps.dirs.images, item.baseFile) : null,
      // 只换二维码时要沿用这几项：图是同一张，评审结论和请求号都不该丢。
      verdict: item.verdict || null,
      requestId: item.requestId || '',
      actionPrompt: item.prompt || '',
      revisedPrompt: item.revisedPrompt || '',
      status: item.status || '',
      interrupted: item.interrupted || '',
      fromDelivery: true,
    };
  }
  return null;
}

async function editPlanNode(session, instruction, deps) {
  // 追问可能指向任何一张图：每张交付图、每张参考图都可能要打开看（最多各算 3 张），再加一次对照底图或原图
  // （真机 5 次追问编辑里 4 次撞到以前固定的 4 次上限）。难度按最难的那张图算。
  const delivered = session.images.filter((image) => image.chosen || lastDelivered(session, image, deps)).length;
  const fontFacts = await fontFactsLine();
  const budget = toolBudget('edit', {
    needs: [
      { count: Math.min(3, Math.max(1, delivered)), what: '打开交付图' },
      { count: Math.min(3, session.refs.length), what: '打开参考图' },
      { count: 1, what: '对照底图或原图' },
    ],
    difficulty: hardestOf(session.images).level,
    hits: hitsOf(session, 'edit'),
  });
  const inventory = session.images
    .map((image) => {
      const chosen = image.chosen || lastDelivered(session, image, deps);
      const codes = (image.spec && image.spec.qrCodes) || [];
      const qr = codes.length
        ? '；画面里有二维码：' +
          codes.map((item) => (item.content ? '内容「' + item.content + '」' : '装饰码（还没给内容）')).join('、')
        : '';
      const layers = overlayLayers(image);
      const words = isOverlay(image)
        ? '；文字由程序排入（底下有一张不带字的底图）：' +
          layers
            .map(
              (layer, index) =>
                '第 ' + index + ' 段「' + shortText(layer.text, 30) + '」' +
                JSON.stringify({ box: layer.box, direction: layer.direction, font: layer.font, color: layer.color, align: layer.align, punctuation: layer.punctuation || undefined, role: layer.role || undefined, part: layer.part || undefined }),
            )
            .join('；')
        : layerTexts(image.spec.textLayers).length
          ? '；画面里的文字是模型直接画的' +
            (textPlaceable(session, image) ? '' : '（位置未知）') +
            '：' +
            layerTexts(image.spec.textLayers).map((value, index) => '第 ' + index + ' 段「' + shortText(value, 30) + '」').join('、')
          : '';
      const charts = imageCharts(image).length
        ? '；图表由程序画入（底下有一张不带图表的底图）：' +
          imageCharts(image)
            .map(
              (chart, index) =>
                '第 ' + index + ' 张 ' + describeChart(chart) +
                JSON.stringify({ box: chart.box, surface: chart.surface || undefined, labels: chart.labels, stacked: chart.stacked || undefined, y_min: chart.yMin === null ? undefined : chart.yMin, colors: chart.colors.length ? chart.colors : undefined }),
            )
            .join('；')
        : '';
      return (
        image.id + '「' + image.title + '」' + (chosen ? ' 当前交付 ' + chosen.id + ' -> ' + chosen.path : '（无交付）') + qr + words + charts +
        (isAnimation(image) ? animationInventory(image) : motionGifInventory(image) + panelGifInventory(image))
      );
    })
    .join('\n');
  const history = refHistory(session);
  const prompt = [
    '你是H3-Image-Executor 的增量编辑节点。用户要在已交付的图上做一处改动。',
    '',
    '用户这次的话：',
    instruction,
    '',
    '已交付的图：',
    inventory,
    '',
    '参考图：',
    session.refs.map((ref) => ref.id + ' -> ' + ref.path + (ref.note ? '（' + ref.note + '）' : '')).join('\n') || '（无）',
    '',
    '这个会话做过的参考图检索：',
    history.length
      ? history.map((item) => '- ' + item.task_name + '「' + item.query + '」：' + (item.ref ? '找到 ' + item.ref : '没找到')).join('\n')
      : '（无）',
    '',
    '做指代解析：改哪张图、改哪部分、哪些必须不变。给出：目标图 imageId、要编辑的候选 candidateId（用当前交付的那张）、',
    '给模型的编辑指令 prompt（只描述要改的地方和必须保持不变的部分）、以及这次新的验收清单 checklist。',
    '',
    'refs：这次修改要用的参考图，写 R 编号，或者检索记录 / 这次 ref_queries 里的 task_name；用户在原话里给了图片地址的，可以照抄那个地址。',
    '不要凭记忆写网址：你写的地址多半打不开，系统也不会用。要找图就写 ref_queries。',
    '只在要引入原图里没有的新实体、或者要照参考图改正某个实体的样子时才写 refs；只是加文字、挪位置、调色这类改动，',
    'refs 一律留空——多塞参考图会让模型照着参考图重画一张全新的图。',
    'prompt 里不要用"这张图""原图"以外的模糊指代，直接说要改什么、什么必须保持不变。',
    '',
    '重新找参考图：',
    '- 要不要检索由你判断。用户说参考图不对、要重新找时写 ref_queries；这次要加进画面的东西是专有名词或特定称谓',
    '  （真人、角色或吉祥物、品牌和产品、logo、车型、地标、具体的作品，或者你不确定长什么样的冷门叫法）而上面还没有它的参考图时，',
    '  建议先写 ref_queries 检索。通用的东西、常见的画风有把握画对就不搜。',
    '  系统会去搜图、下载、筛选，找到的图会自动用到这次修改里。上面检索记录里「没找到」的实体要全部重新写；',
    '  已经找到的，只有用户点名说不对、或者你从交付图上能看出它明显不对时才重写，并在 replaces 里写它的 R 编号。',
    '- ref_budget：这次检索最多花多少次调用（0-' + DEFAULTS.refBudgetMax + '，搜图一次 1 次、判定一批候选 1 次，一项顺利时 2 次、要换说法重搜 4–6 次）。',
    '  不写时按每项 2 次、至少 ' + DEFAULTS.refBudgetDefault + ' 次给；最要紧的项写在前面，预算花完后面的就不搜了。',
    '- 每项形如 {"task_name":"myaku_myaku","query":"…","alt_query":"…","use":"subject","take":"…","prompt":"…","replaces":""}：',
    '  query 写东西的正式名称 + 一个用途词（官方图 / 照片 / 实拍 / 样例），不要堆「手办 摆件 正面」这类泛词；',
    '  alt_query 写它在原产地语言或英文里的正式名称；use 写用途（subject 主体外观 / detail 局部 / style 画风 / layout 版式 / scene 场景），',
    '  take 一句话写从它身上取什么；prompt 只写「必须是哪个东西（或哪一类东西的真实样例）」和最多一条用途，可以带上用户这次的反馈，',
    '  不要写颜色、五官、肢体数量这类外观细节，也不要写互相冲突、实际拍不到的条件。',
    '- 这次只是重新找参考图、没有别的改动时，refs_only 写 true：重新检索一张新图都没找到时，系统不会白白重画一遍。',
    '- 写了 ref_queries 时，prompt 和 checklist 里不要再写这些实体的外观细节，写「外观与参考图一致」；',
    '  之前凭记忆写进 prompt 的外观描述，这次一并去掉，否则会和参考图打架。',
    '',
    '二维码：码由系统生成真码、贴回画面、扫码验证，你只负责记下码里放什么。',
    '- 用户这次给了或改了二维码里要放的内容（链接、文字、号码），写进 qr_codes，每项 {"content":"…","where":"…"}：',
    '  content 从用户这次的话里逐字复制，一个字符都不要改，不要补全、不要缩写、不要自己编。',
    '- 用户这次只是在给二维码内容或换内容、没有别的改动，而且那张图里本来就有二维码时，qr_only 写 true：',
    '  系统直接在原图上把码换成真码，不重新生图，prompt 和 checklist 可以留空。',
    '- 用户还要改别的地方，或者图里本来没有二维码要新加一个，qr_only 写 false，qr_codes 照样写。',
    '- 用户要把二维码去掉，qr_remove 写 true，并在 prompt 里写清楚去掉它、原位置换成什么。',
    '- 这次没提二维码就不写 qr_codes。checklist 里不要写「二维码能扫」这类条目，系统会自己验。',
    '',
    '文字：',
    '- 标着「文字由程序排入」的图，字是程序用字体排上去的。用户这次只改字（改内容、换字体、调大小、挪位置、换颜色、横排竖排、标点），',
    '  text_only 写 true，并在 text_layers 里写要改的那几段：每项 {"index":0, 要改的字段}，例：{"index":0,"text":"…"}、{"index":0,"font":"song"}。',
    '  可改的字段：text、box（[左,上,右,下]，0-1 的画面比例）、direction（horizontal / vertical）、font（brush / xing / kai / song / hei）、',
    '  color（十六进制）、align（start / center / end）、punctuation（omit / side / inline，竖排才有）、',
    '  role（title / subtitle / body / footnote / caption / label / page / pinyin：同一种 role 的几段统一字号；body 首行空两格、两端对齐；',
    '  footnote 上方画一条短分隔线）、indent（body 首行空几格，0-4）、rule（footnote 写 false 不画分隔线）、',
    '  part（一个字里要两种颜色时写，{"side":"left","color":"#E8710A"}：每个汉字 side 那一侧的部件用这个颜色，其余用 color；写 false 去掉）。',
    '  用户说「几段字号不一样」「段首没空格」「脚注上面要分隔线」，就给对应的段落补上 role；正文里的脚注符号（①②…）写在被注的字后面，程序排成上标。',
    '  用户要「清」的「氵」换个颜色，就给写着「清」的那一段加 part，不要把字拆成「氵」「青」两段拼。',
    '  本机实际用的字体：' + fontFacts + '。',
    '  index 是上面写的第几段，只写要改的字段，没写的保持不变；改了内容的，text 写改完之后的整段文字，逐字照用户的话改，其余一个字都不要动。',
    '  字号跟着 box 走，「字大一点」就把 box 放大。要加一段新字，不写 index，text 和 box 必填；要删掉一段，写 {"index":1,"remove":true}。',
    '  系统直接在底图上重新排字，不重新生图，prompt 和 checklist 可以留空。',
    '- 程序排字的图，用户还要改画面别的地方：text_only 写 false；字也要跟着改的照样写 text_layers，prompt 里不要写文字内容，字之后由程序重新排。',
    '- 标着「模型直接画的」字，用户说写错了、漏字了、要改字时，同样写 text_only true（要改内容就写 text_layers）：',
    '  系统会让模型先把字擦掉，再由程序按原文排字。标着「位置未知」的段落，在 text_layers 里补上 box：',
    '  看一眼当前交付的图，写这段字在画面里的位置 [左,上,右,下]；不写的话改字交给模型重画。',
    '- 模型直接画的字，用户还要改画面别的地方：text_only 写 false，prompt 里逐字写清字要改成什么，text_layers 照样写。',
    '- 这次没提文字就不写 text_layers，text_only 写 false。',
    '',
    '图表：',
    '- 标着「图表由程序画入」的图，图表是程序按数据画上去的。用户这次只改图表（改数、加减类目、换图表类型、改标题、单位、颜色、位置、标注方式），',
    '  chart_only 写 true，并在 charts 里写要改的那几张：每项 {"index":0, 要改的字段}，例：{"index":0,"series":[{"name":"销售额","values":[120,150,200]}]}、{"index":0,"type":"line"}。',
    '  可改的字段：type（bar / hbar / line / area / pie / donut）、title、unit、categories、series、stacked、labels（value / percent / both / none）、',
    '  y_min（只有折线图、面积图能用）、box、surface、colors。index 是上面写的第几张，只写要改的字段，没写的保持不变。',
    '  改数据的，categories 和 series 写改完之后的完整数据：数从用户的话里逐个照抄，用户没提到的数一个都不要动，比例、合计由程序算。',
    '  要加一张新图表，不写 index，type、categories、series、box 必填；要删掉一张，写 {"index":1,"remove":true}。',
    '  系统直接在不带图表的底图上重画图表，不重新生图，prompt 和 checklist 可以留空。',
    '- 图里原来没有程序画的图表，这次要加一张：chart_only 写 true，charts 照样写（不写 index）；画面上那块地方要是不空，',
    '  系统会自动让模型先在 box 的位置留出一块空白面板，再画图表。',
    '- 用户还要改画面别的地方：chart_only 写 false；图表也要跟着改的照样写 charts，prompt 里不要描述图表和数字，图表之后由程序重新画。',
    '- 这次没提图表就不写 charts，chart_only 写 false。',
    '',
    '动图（GIF）：',
    '- 标着「GIF 的参考图，还没出帧」的图：用户确认参考图、说可以开始做动图时，animation 写 {"start":true}，prompt 和 checklist 留空。',
    '  用户要先改参考图（换颜色、改姿势、换背景），照常写 prompt 和 checklist，不写 animation：改完系统会再请用户确认。',
    '- 标着「这是 GIF」的图，用户只调动图本身时写 animation、prompt 留空，可以同时写几项：',
    '  {"frame_ms":500} 每帧停多少毫秒（「慢一点」就加大，「快一点」就减小，60–3000）；{"loop":false} 只播一遍；',
    '  {"edge":1024} GIF 长边多少像素（240–1024）；{"hold":[{"index":1,"ms":800}]} 某几帧停久一点；',
    '  {"transition":"cut"} 帧和帧之间直接切换（「别要渐变」「干脆一点」），{"transition":"fade"} 加渐变过渡（「更顺一点」「加过渡」）；',
    '  {"drop":[6]} 去掉第几帧；{"order":[1,3,2,4]} 新的播放顺序（写出要留下的所有帧号，没写的帧会去掉）；',
    '  {"redo":[{"index":3,"prompt":"…"}]} 重画第几帧，prompt 写这一帧新的样子：写全这一帧和参考图相比要变的所有地方，',
    '  包括前面帧延续下来、这一帧要保持的状态（重画时模型看得到前一帧和参考图，但不知道计划里这一帧该是什么样），没有新要求就留空；',
    '  {"add":[{"after":2,"prompt":"…"}]} 在第几帧后面加一帧，prompt 同样写全新帧和参考图相比要变的所有地方。',
    '  帧号就是上面列出来的第几帧。只调时长、尺寸、顺序、过渡、删帧时不调用生图，几秒就好。',
    '- 用户要改的是整组动图里的主体或画面本身（换颜色、换衣服、换背景）：照常写 prompt 改参考图，不写 animation。',
    '  系统会先把参考图改好交给用户确认，再重新出全部帧。',
    '- 不是 GIF 的分格组图（一张图里分成好几格：六格表情、四格漫画、九宫格、分步图），用户要把它做成 GIF、动图：',
    '  animation 写 {"from_panels":true}，prompt 和 checklist 留空。系统把格子切开、按顺序拼成 GIF，组图本身不重画；',
    '  相邻两格之间会各补一格中间状态（一次生图、一两分钟），用户说「直接拼就行」「不要补帧」时再加 "smooth":false。',
    '  看得出几行几列就写上 "rows"、"cols"；用户点名了顺序、快慢，按下一条的字段一起写。',
    '  图里只有一个画面、没有分格，也照样写 from_panels：系统切不出格子时会如实告诉用户，不会重画。',
    '- 标着「组图拼成的 GIF」的图，用户只调 GIF 本身时写 animation、prompt 留空，可以同时写几项：',
    '  {"frame_ms":500} 每格停多少毫秒；{"first_ms":1200}、{"last_ms":2000} 第一格、最后一格停多久；{"hold":[{"index":6,"ms":2000}]} 某几格停久一点；',
    '  {"order":[1,2,3,6]} 新的播放顺序（写出要留下的所有格子编号）；{"drop":[3]} 去掉第几格；{"pingpong":true} 来回播；{"loop":false} 只播一遍；',
    '  {"transition":"fade"} 两格之间渐变，{"transition":"cut"} 直接切换；{"edge":1024} GIF 长边（240–1024）；',
    '  {"bounce":true} 切换时让新的一格先放大一点再落回（用户点名要「弹一下」才写：整幅画面会跟着跳一下）；',
    '  用户说切换时画面跳一下、抖一下、闪一下，而这张 GIF 标着切换时弹一下，写 {"bounce":false}；',
    '  {"rows":2,"cols":3} 格子切错了，按几行几列重新切。格子编号从上到下、从左到右数。',
    '  {"smooth":true} 相邻两格之间补过渡格（「更顺一点」「中间补几帧」；之前没补成的会再试一次，要多一次生图），',
    '  {"smooth":false} 不补，两格之间直接切换（「不要补帧」「直接切就行」）。清单里写了「补了几步过渡格」的，用户没提就不用写。',
    '  只写用户这次要改的项：上面清单里现有的设定（每格多久、顺序、弹不弹）用户没提到的不要照抄进来；用户只说「重新做成 GIF」，写 {"from_panels":true}。',
    '- 用户要让一张不是 GIF 的图绕中心转起来（「让这个加载圈转起来」「logo 转一圈」）：animation 写',
    '  {"motion":{"type":"spin","center":[0.5,0.5],"radius":0.32,"steps":12,"direction":"cw"}}，prompt 留空。center、radius 按这张图里',
    '  转动的东西在哪、多大来写（看一眼交付图），steps 写圆环上等距的点或辐条数，连续转写 0。系统由程序转出各帧，不重新生图。',
    '- 标着「程序绕圆心转出来的 GIF」的图，用户只调转法时写 animation、prompt 留空：{"motion":{"frame_ms":60}} 每格停多久（「快一点」就减小，最短 20）；',
    '  {"motion":{"direction":"ccw"}} 换方向；{"motion":{"steps":8}} 一圈几格（0 是连续转）；{"motion":{"center":[0.5,0.48],"radius":0.3}} 圆心不对、',
    '  转的范围不对时按交付图重写；{"transition":"cut"} / {"transition":"fade"} 两格之间直接切换还是渐变；{"loop":false} 只转一圈；{"edge":512} GIF 长边。',
    '  要改画面本身（换颜色、换样式），照常写 prompt 改图，不写 animation，改完系统按新图重新转。',
    '- 组图拼成的 GIF，用户要改某一格的画面（「第 3 格改成生气」）：照常写 prompt 改组图，写清第几行第几格改成什么、其余格子不变，',
    '  不写 animation；改完系统按新的组图重新拼 GIF。',
    '',
    '工具调用上限 ' + budget.limit + ' 次：只 read 上面列出的图，判断清楚就直接给结论。',
    '',
    '只输出 JSON：',
    '{"imageId":"A","candidateId":"A-r1-g0","prompt":"...","refs":[],"ref_queries":[],"ref_budget":0,"refs_only":false,"keep":["..."],"qr_only":false,"qr_remove":false,"qr_codes":[],"text_only":false,"text_layers":[],"chart_only":false,"charts":[],"animation":null,"checklist":[{"id":"H1","kind":"hard","text":"...","verify":"vlm"}]}',
  ].join('\n');
  const edited = await deps.agent.runJson(session, { step: 'edit', instruction: prompt, maxTools: budget.limit, budgetNote: budget.note });
  noteToolHit(session, 'edit', edited);
  const { data } = edited;
  if (!data || !data.imageId) return null;
  return {
    imageId: String(data.imageId).toUpperCase(),
    candidateId: data.candidateId || null,
    prompt: data.prompt || instruction,
    promptGiven: Boolean(String(data.prompt || '').trim()),
    refs: Array.isArray(data.refs) ? data.refs : [],
    refQueries: normalizeRefQueries(data.ref_queries),
    refBudget: data.ref_budget,
    refsOnly: data.refs_only === true,
    checklist: Array.isArray(data.checklist) && data.checklist.length
      ? normalizeChecklist(data.checklist, [], String(data.prompt || ''))
      : null,
    qrOnly: data.qr_only === true,
    qrRemove: data.qr_remove === true,
    qrCodes: Array.isArray(data.qr_codes) && data.qr_codes.length ? data.qr_codes : null,
    textOnly: data.text_only === true,
    textLayers: Array.isArray(data.text_layers) && data.text_layers.length ? data.text_layers : null,
    chartOnly: data.chart_only === true,
    charts: Array.isArray(data.charts) && data.charts.length ? data.charts : null,
    animation: normalizeAnimationOps(data.animation),
  };
}

// ---------------------------------------------------------------- 07 交付

// ---------------------------------------------------------------- 跨图一致性
//
// 逐图评审看不到别的图，所以"同一只狐狸从巴掌大画成大型犬"这种漂移，每张单看都挑不出毛病
// （实测那组四格漫画 4 张 hard 全 5/5）。所有图出完之后并排比一次，是唯一抓得住它的位置。
async function crossImageReview(session, deps) {
  session.crossCheck = null;
  const picked = session.images.filter((image) => image.chosen && !image.blocked);
  if (picked.length < 2) return;
  try {
    await deps.ensureDir(deps.dirs.sheets);
    const sheetPath = join(deps.dirs.sheets, 'cross-' + Date.now() + '.png');
    const sheet = await review.buildGridSheet(
      picked.map((image) => ({ path: image.chosen.path, label: image.id })),
      sheetPath,
      { perRow: Math.min(4, picked.length) },
    );
    if (!sheet || !sheet.items.length) return;

    const characters = session.characterRefs || [];
    const refSheet = characters.length ? await ensureRefSheet(session, deps) : null;
    // 对比图、基准图材料各打开一次；看不清时还要核对原图，靠按难度给的余量（实测上限 3 次会在读基准图时就被打断）。
    const budget = toolBudget('cross', {
      needs: [
        { count: 1, what: '并排对比图' },
        { count: refSheet ? 1 : 0, what: '角色基准图材料' },
      ],
      difficulty: hardestOf(picked).level,
      hits: hitsOf(session, 'cross'),
    });
    const instruction = [
      '你是H3-Image-Executor 的跨图一致性评审节点。下面这张并排对比图把同一次任务里的所有成图放在一起了，',
      '每张左上角的编号就是图 id。你只看这一张，不要再去打开原始大图。',
      '',
      '用户原话：',
      session.instruction,
      '',
      '并排对比图：' + sheetPath,
      '参评图：' + picked.map((image) => image.id + '（' + image.title + '）').join('、'),
      '',
      characters.length
        ? '本组有角色基准图，理论上主体外观应当与它一致。基准图材料：' +
          (refSheet || '（无）') +
          '\n原始文件：' +
          characters.map((ref) => ref.id + ' -> ' + ref.path).join('；')
        : '本组没有角色基准图，主体一致性完全靠各图自己的文字描述。',
      '',
      '只判断一件事：这几张图里的同一个主体，是不是同一个东西。',
      '重点核对体型与比例（最容易被画大画小）、脸型、发型与发色、眼睛、服装款式与配色、标志性配件、画风与线条质感。',
      '不要评价单张图好不好看、构图巧不巧妙——那些已经由逐图评审负责了。',
      '',
      '判定规则：',
      '1. consistent 只在"所有重复出现的主体在各图之间看不出差别"时才为 true。',
      '2. 只要有一个主体在任意两张图之间出现可辨认的差异，就是 false，并在 issues 里点名。',
      '3. issues 每项形如 {"image":"C","subject":"小狐狸","problem":"..."}；image 写偏差最明显的那张，',
      '   problem 必须写清楚"和哪张比、差在哪"（例：与 A 相比狐狸从巴掌大变成中型犬大小）。',
      '4. 某个主体只在其中一张图出现、别处没有可比对象时，不要为它编造不一致。',
      '',
      '只输出一个 JSON 对象，不要解释、不要 markdown 代码块：',
      '{"consistent":true,"summary":"一句话结论","issues":[{"image":"C","subject":"小狐狸","problem":"..."}]}',
      '工具调用上限 ' + budget.limit + ' 次。',
    ].join('\n');

    const crossRun = await deps.agent.runJson(session, { step: 'cross', instruction, maxTools: budget.limit, budgetNote: budget.note });
    noteToolHit(session, 'cross', crossRun);
    const { data } = crossRun;
    const issues = Array.isArray(data && data.issues)
      ? data.issues
          .map((item) => ({
            image: String((item && item.image) || '').trim().toUpperCase(),
            subject: String((item && item.subject) || '').trim(),
            problem: String((item && item.problem) || '').trim(),
          }))
          .filter((item) => item.problem)
      : [];
    const consistent = Boolean(data) && data.consistent !== false && !issues.length;
    session.crossCheck = {
      consistent,
      summary: String((data && data.summary) || '').trim(),
      issues,
      sheet: sheetPath,
      checkedAt: Date.now(),
    };
    if (!consistent) {
      for (const issue of issues.slice(0, 3)) {
        session.questions.push(
          '跨图一致性：' + (issue.image ? issue.image + ' 的' : '') + (issue.subject || '主体') + ' — ' + issue.problem,
        );
      }
    }
    deps.emit(
      session,
      'verify',
      '跨图一致性：' + (consistent ? '主体在各图之间一致' : '发现 ' + issues.length + ' 处不一致'),
      {
        level: consistent ? 'info' : 'warn',
        detail: detail('跨图一致性', [
          kv('结论', consistent ? '一致' : '不一致'),
          kv('参评图', picked.map((image) => image.id).join('、')),
          kv('角色基准', characters.length ? characters.map((ref) => ref.id + ' · ' + ref.note).join('、') : '无'),
          text('说明', session.crossCheck.summary || ''),
          issues.length
            ? list(
                '不一致明细',
                issues.map((item) => ({
                  tag: 'fail',
                  text:
                    (item.image ? '[' + item.image + '] ' : '') +
                    (item.subject ? item.subject + '：' : '') +
                    item.problem,
                })),
              )
            : null,
        ]),
      },
    );
  } catch (error) {
    // 跨图评审是加分项：跑不成也要照常交付，绝不能因为它让整组图出不去。
    deps.emit(session, 'verify', '跨图一致性评审未完成：' + describeError(error), { level: 'warn' });
  }
}

async function deliver(session, deps) {
  session.deliveryVersion += 1;
  const version = session.deliveryVersion;
  const dir = join(deps.dirs.deliver, 'v' + version);
  await deps.ensureDir(dir);
  const items = [];
  // 同一批交付共用一个时间戳：它们属于同一次交付，文件名带同一个时刻更好归档。
  const stampText = fileStamp(new Date());
  const usedNames = new Set();
  // 二维码要请用户处理的事只挂在这一版交付上（见 qrQuestions）。
  const qrNotes = [];
  // 交付文件名：H3-Image_<内容英文简写>_<时间戳>。规划节点给的 slug 可能重复（同一个主体出现在多张图里），
  // 重名会互相覆盖，这里补序号。
  const nameFor = (image) => {
    const slug = normalizeSlug(image.spec && image.spec.slug, String(image.id).toLowerCase());
    let base = 'H3-Image_' + slug + '_' + stampText;
    for (let n = 2; usedNames.has(base); n += 1) base = 'H3-Image_' + slug + '-' + n + '_' + stampText;
    usedNames.add(base);
    return base;
  };
  for (const image of session.images) {
    const anim = isAnimation(image) ? image.animation : null;
    // 这一轮追问没做成的组图 GIF（不是分格的组图）：只在这一版交付里说一次。
    if (image.panelGifNotice) {
      qrNotes.push(image.panelGifNotice);
      image.panelGifNotice = '';
    }
    // 合成好的 GIF（或者用户给的参考图直接出帧、却没做成的）。
    if (anim && (anim.state === 'done' || (anim.state === 'failed' && !image.chosen))) {
      const { item, notes } = await deliverAnimation(session, image, deps, animationHooks(), { dir, version: 'v' + version, base: nameFor(image) });
      items.push(item);
      qrNotes.push(...notes);
      continue;
    }
    if (!image.chosen) {
      // reason 以前只取 blockReason，而生成失败根本没走阻塞那条路，
      // 结果页面上只剩一句「未生成」，用户完全看不到接口报了什么。
      items.push({
        id: image.id,
        title: image.title,
        status: image.status,
        blocked: image.blocked,
        reason: image.blockReason || lastFailReason(image) || '所有轮次都没有产出可用候选',
        contentPolicy: Boolean(image.contentPolicy),
        rounds: image.rounds.length,
      });
      continue;
    }
    // 程序转的 GIF、组图拼的 GIF：同一张图、同样的设定做过就直接用，图改过、设定改过才重做。
    const motionState = !anim && image.spec.motionGif ? await composeMotionGif(session, image, deps, panelHooks()) : null;
    const panelState = !anim && !motionState && image.spec.panelGif ? await composePanelGif(session, image, deps, panelHooks()) : null;
    const chosenExt = extensionFor(await readFile(image.chosen.path));
    const base = nameFor(image);
    const deliverName = base + chosenExt;
    const previewName = base + '-preview.png';
    const target = join(dir, deliverName);
    await copyFile(image.chosen.path, target);
    const preview = join(dir, previewName);
    if (image.chosen.preview) await copyFile(image.chosen.preview, preview);
    const qr = qrDelivery(image, image.chosen);
    qrNotes.push(...qrQuestions(image, qr));
    const typed = textDelivery(image, image.chosen);
    if (typed && typed.status === 'failed') {
      qrNotes.push(image.id + ' 的文字没能由程序排进去（' + typed.note.replace(/^文字没排上：/, '') + '）。可以回复「重画」重新生成这张图');
    }
    const droppedText = (image.spec.textOverlay && image.spec.textOverlay.dropped) || [];
    if (typed && droppedText.length) {
      qrNotes.push(
        image.id + ' 的文字超过 ' + MAX_TEXT_LAYERS + ' 段，这几段没排进去：' + droppedText.map((value) => '「' + shortText(value, 12) + '」').join('') +
          '。可以把相邻的几段合成一段再试',
      );
    }
    // 部件分色没做成、或者为了分色换了字体：照实告诉用户，免得以为颜色是对的。
    if (typed && typed.status === 'overlay') {
      const summaryItems = (image.chosen && image.chosen.program && image.chosen.program.text && image.chosen.program.text.items) || [];
      for (const item of summaryItems) {
        if (!item.part) continue;
        if (!item.part.ok) qrNotes.push(image.id + ' 的「' + shortText(item.text, 8) + '」部件分色没做成' + (item.part.note ? '：' + item.part.note : ''));
        else if (item.part.note) qrNotes.push(image.id + ' 的「' + shortText(item.text, 8) + '」' + item.part.note);
      }
    }
    // 规划改过一次文字层，按版面还是读不出用户要的字：交付时照实说。
    if ((image.spec.readingProblems || []).length) {
      qrNotes.push(image.id + ' 的文字按版面读不出' + image.spec.readingProblems.map((item) => '「' + item.quote + '」').join('、') + '，请核对这几处');
    }
    const charted = chartDelivery(image, image.chosen);
    qrNotes.push(...chartQuestions(image, charted));
    // 出图中途停下、交的是停下前的图：交付卡片上要看得到，不能只藏在折叠的详情里。
    const interrupted = image.interrupted || '';
    if (interrupted) {
      qrNotes.push(image.id + ' 出图中途停下（' + interrupted + '），交付的是停下前已有的图。稍后可以在这个会话里说「重画」再试一次');
    }
    const item = {
      id: image.id,
      title: image.title,
      status: image.status,
      candidateId: image.chosen.id,
      file: 'v' + version + '/' + deliverName,
      previewFile: image.chosen.preview ? 'v' + version + '/' + previewName : null,
      size: image.chosen.size,
      requestId: image.chosen.requestId,
      reason: image.chosenReason || (image.status === 'passed' ? 'hard 约束全部通过' : ''),
      rounds: image.rounds.length,
      verdict: image.chosen.verdict || null,
      program: image.chosen.program || null,
      prompt: image.chosen.actionPrompt || image.spec.prompt,
      revisedPrompt: image.chosen.revisedPrompt,
      qr,
      text: typed,
      chart: charted,
      baseFile: (image.chosen.basePath && image.chosen.baseFile) || null,
      interrupted,
    };
    // 图照常交付，GIF 和帧条跟着这一版一起写进交付目录。
    if (motionState && motionState.state === 'done') {
      const gifName = base + '.gif';
      const stripName = base + '-frames.png';
      await copyFile(join(deps.dirs.images, motionState.gifFile), join(dir, gifName));
      await copyFile(join(deps.dirs.images, motionState.stripFile), join(dir, stripName));
      item.gif = motionGifItem(motionState, { gif: 'v' + version + '/' + gifName, strip: 'v' + version + '/' + stripName });
    } else if (motionState && motionState.state === 'failed') {
      qrNotes.push(image.id + ' 没转成 GIF（' + motionState.error + '），交付的是这张图。可以说「重新转」再试');
    }
    if (panelState && panelState.state === 'done') {
      const gifName = base + '.gif';
      const stripName = base + '-frames.png';
      await copyFile(join(deps.dirs.images, panelState.gifFile), join(dir, gifName));
      await copyFile(join(deps.dirs.images, panelState.stripFile), join(dir, stripName));
      item.gif = panelGifItem(panelState, { gif: 'v' + version + '/' + gifName, strip: 'v' + version + '/' + stripName, tweenNote: tweenNoteFor(image, panelState) });
    } else if (panelState && panelState.state === 'failed') {
      qrNotes.push(
        image.id + ' 的组图没拼成 GIF（' + panelState.error + '），交付的是组图。' +
          (panelState.notGrid ? '确定是分格的组图的话，可以说「按 2 行 3 列切成 GIF」这样指定几行几列' : '可以说「重新拼 GIF」再试'),
      );
      // 切不出格子的设定不留着：不然之后每次交付都会再切一遍、再挂一遍这句。说了几行几列会重新记下。
      if (panelState.notGrid) {
        image.spec.panelGif = null;
        image.panelGif = null;
      }
    }
    // 动图的参考图：先交给用户确认，帧等确认之后再出。
    if (anim && (anim.state === 'awaiting_confirm' || !anim.state)) {
      item.animation = awaitingInfo(image);
      qrNotes.push(
        image.id + ' 是 GIF 的参考图：满意就点「生成 GIF」（或者回复「用这张做 GIF」），开始出 ' + item.animation.frames.length +
          ' 帧；要改参考图就直接说改哪里。1 分钟内没有回应会默认确认、自动开始出帧，不想自动开始就点「先别生成」',
      );
    } else if (anim && anim.state === 'failed') {
      item.animation = { state: 'failed', error: anim.error || '' };
      qrNotes.push(image.id + ' 的 GIF 没做成（' + (anim.error || '能用的帧不到 2 帧') + '），交付的是参考图。可以说「重新出帧」再试');
    }
    items.push(item);
  }
  const questions = session.questions.concat(qrNotes);
  // 跨图结论要给页面看，但对比图是本地绝对路径，不能带出去。
  const cross = session.crossCheck
    ? {
        consistent: session.crossCheck.consistent,
        summary: session.crossCheck.summary,
        issues: session.crossCheck.issues,
      }
    : null;
  const report = {
    version,
    createdAt: Date.now(),
    instruction: session.instruction,
    route: session.route,
    items,
    questions,
    crossCheck: cross,
    cost: session.cost,
  };
  await writeFile(join(dir, 'report.json'), JSON.stringify(report, null, 2));
  session.delivery = {
    version,
    dir,
    items,
    questions: questions.slice(),
    crossCheck: cross,
    cost: { ...session.cost },
  };
  // 交付要挂到当前这一轮对话上，页面上它才会出现在对应的用户消息下面。
  const turn = session.turns && session.turns[session.turns.length - 1];
  // cost 记的是"交付这一版时的会话累计成本"，页面靠它算出这一轮自己花了多少。
  if (turn) {
    turn.delivery = {
      version,
      items,
      questions: questions.slice(),
      crossCheck: cross,
      cost: { ...session.cost },
    };
  }
  // 一张都没出来就不能叫「已交付」：页面上会显示「交付 0 张」，
  // 但没有任何解释，用户看到的是「跑完了却什么都没发生」。
  // 这类必须判成失败，并把每张图的失败原因带出去。
  const okCount = items.filter((item) => item.file).length;
  const failedItems = items.filter((item) => !item.file);
  if (!okCount && failedItems.length) {
    session.status = 'failed';
    session.fatal =
      session.fatal ||
      failedItems.map((item) => item.id + ' ' + item.reason).join('；').slice(0, 500);
  } else {
    // 交出了图就是「已交付」：中途出过错（配置错误、接口故障）的原因已经写在交付卡片和待确认里。
    // 以前只要 fatal 有值就整轮标失败，页面上图明明在，状态却是「失败」。
    session.status = okCount || !session.fatal ? 'delivered' : 'failed';
  }
  const deliverText = okCount
    ? '交付 v' + version + '：' + okCount + ' 张图' + (failedItems.length ? '（' + failedItems.length + ' 张失败）' : '')
    : '交付 v' + version + '：0 张图，' + failedItems.length + ' 张全部失败';
  const deliverLevel = okCount ? (failedItems.length ? 'warn' : 'info') : 'error';
  deps.emit(session, 'deliver', deliverText, {
    version,
    level: deliverLevel,
    detail: detail('交付 v' + version, [
      ...items.map((item) =>
        group(item.id + ' · ' + item.title, [
          kv('状态', item.status === 'passed' ? '通过' : item.file ? '未通过（选优交付）' : '未生成'),
          kv('尺寸', item.size || '-'),
          kv('候选', item.candidateId || '-'),
          kv('轮次', item.rounds || 0),
          kv('request_id', item.requestId || '-'),
          item.qr
            ? kv(
                '二维码',
                item.qr.items.map((one) => (one.content ? '「' + one.content + '」' : '') + one.note).join('；'),
              )
            : null,
          item.text ? kv('文字', item.text.note) : null,
          text('理由', item.reason || ''),
        ]),
      ),
      cross
        ? group('跨图一致性', [
            kv('结论', cross.consistent ? '主体在各图之间一致' : '发现 ' + cross.issues.length + ' 处不一致'),
            text('说明', cross.summary || ''),
            cross.issues.length
              ? list(
                  '明细',
                  cross.issues.map((item) => ({
                    tag: 'fail',
                    text:
                      (item.image ? '[' + item.image + '] ' : '') +
                      (item.subject ? item.subject + '：' : '') +
                      item.problem,
                  })),
                )
              : null,
          ])
        : null,
      kv('生图', session.cost.ditImages + ' 张 · ' + seconds(session.cost.ditMs)),
      kv('Agent', session.cost.agentCalls + ' 次 · ' + seconds(session.cost.agentMs) + ' · ' + (session.cost.agentTools || 0) + ' 次工具'),
      session.cost.usage ? kv('token', session.cost.usage.total_tokens) : null,
      list('待你确认', questions.map((item) => ({ text: item, tag: 'warn' }))),
    ]),
  });
  // 交付完立刻把分享页备好：发布是 Agent 侧的事，落盘提前做完，
  // 用户点「分享」时链接往往已经回填，点一下就是复制，不用再等一轮。
  if (typeof deps.afterDeliver === 'function') {
    try {
      await deps.afterDeliver(session);
    } catch (error) {
      // 分享页生成失败不影响交付本身，用户仍可手动点「分享」重试。
    }
  }
}

function summarizeAction(action) {
  return {
    type: action.type,
    prompt: action.prompt,
    parentId: action.parentId || null,
    refs: action.refs || [],
    overlay: Boolean(action.overlay),
    ...(action.textPatches ? { textPatches: action.textPatches } : {}),
  };
}

function describeAction(action) {
  if (!action) return '未知动作';
  if (action.type === 'edit') {
    if (action.parentPath) return '在 ' + (action.parentId || '上一张') + ' 上编辑';
    return '按参考图生成（没有可用底图）';
  }
  if (action.type === 'generate') return '重新生成' + (action.overlay ? '（不带字的底图）' : '');
  if (action.type === 'qr') return '只换二维码（不重新生图）';
  if (action.type === 'text' && action.textPatches) return '在 ' + (action.parentId || '上一张') + ' 的底图上挪 ' + action.textPatches.length + ' 段字重新排（不重新生图）';
  if (action.type === 'text') return '只改文字（在不带字的底图上重新排，不重新生图）';
  return action.type;
}

function mergeUsage(current, usage) {
  if (!usage) return current || null;
  const base = current || { total_tokens: 0, image_out: 0, text_in: 0, image_in: 0 };
  base.total_tokens += usage.total_tokens || 0;
  base.image_out += (usage.output_tokens_details && usage.output_tokens_details.image_tokens) || 0;
  base.text_in += (usage.input_tokens_details && usage.input_tokens_details.text_tokens) || 0;
  base.image_in += (usage.input_tokens_details && usage.input_tokens_details.image_tokens) || 0;
  return base;
}

function dedupe(list) {
  return Array.from(new Set(list.filter(Boolean)));
}
