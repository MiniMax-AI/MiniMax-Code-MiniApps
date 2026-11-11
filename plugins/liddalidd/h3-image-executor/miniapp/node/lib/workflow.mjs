// H3-Image-Executor 状态机：00 输入 -> 01 分诊 -> 02 THINK/检索 -> 03 PLAN -> 04 PAINT
// -> 05 VERIFY（程序检查 + 色偏校正 + VLM 评审）-> 06 REFINE -> 07 DELIVER -> 08 增量编辑。
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import * as h3 from './h3.mjs';
import * as png from './png.mjs';
import * as review from './review.mjs';
import { searchRefImages, normalizeRefQueries, broadenQuery } from './refsearch.mjs';
import { createRefCache } from './refcache.mjs';
// 接口返回的不一定是 PNG：实测同一个端点有时回 JPEG。只用 png.decodePng 会让整条
// 程序校验链路（尺寸 / 色偏 / 锐度 / 预览图 / 评审看图材料）在 JPEG 响应下静默失效，
// 而图照样交付——用户看到的是「已交付」，看不到「其实一项都没验」。
import { decodeImage, extensionFor } from './image.mjs';
import { detail, group, kv, list, seconds, text, thumbs } from './detail.mjs';

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
  // 各节点的工具调用硬上限（运行时强制，超了就中断并强制收尾）。
  toolBudget: { plan: 10, judge: 6, refine: 4, select: 2, edit: 4 },
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
  // 评审节点的工具调用预算，写进提示词用于约束 agent。
  judgeToolBudget: 5,
  refDownloadLimit: 8,
  // 参考图：一批先下 3 张判定，不合格再取下一批；池子空了就换个说法再搜。
  refBatch: 3,
  refGateRounds: 3,
  refSearchRounds: 2,
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

function withColorRetry(prompt) {
  const base = String(prompt || '').trim();
  return base.includes('上一轮输出整体偏红') ? base : base + COLOR_RETRY_CLAUSE;
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
function composePrompt(slots, freeText, instruction, hasSlots) {
  if (!hasSlots) {
    const legacy = String(freeText || instruction || '').trim();
    return { prompt: legacy ? legacy + '。' + COLOR_CLAUSE : COLOR_CLAUSE, missing: [], slots: null };
  }
  const missing = [];
  const filled = { ...slots };
  for (const spec of SLOT_SPEC) {
    if (filled[spec.key]) continue;
    if (!spec.required) continue;
    missing.push(spec.label);
    filled[spec.key] = spec.key === 'subject' ? String(instruction || '').trim() : spec.fallback;
  }

  const parts = [];
  const head = [filled.style, filled.shot].filter(Boolean).join('，');
  if (head) parts.push(head + '。');
  for (const spec of SLOT_SPEC) {
    if (spec.key === 'style' || spec.key === 'shot') continue;
    if (!filled[spec.key]) continue;
    parts.push(spec.label + '：' + filled[spec.key] + '。');
  }
  if (filled.text) parts.push('图内文字：' + filled.text + '，字形正确、清晰可读。');
  if (filled.negative) parts.push('不要出现：' + filled.negative + '。');
  parts.push(COLOR_CLAUSE);

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
  const queue = session.images.filter((image) => !image.blocked);
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
  // 所有图都出完了才比得了：逐图评审看不到别的图，跨图漂移只能在这里抓。
  await crossImageReview(session, deps);
  if (isCancelled(session)) return;
  await deliver(session, deps);
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
async function runRefSearch(session, queries, deps) {
  const startedAt = Date.now();
  deps.emit(session, 'think', '检索参考图：' + queries.map((item) => item.query).join('、'), {
    detail: detail('检索节点 · 输入', [
      text(
        '检索意图',
        queries.map((item) => item.task_name + '：' + item.query).join('\n'),
      ),
      list(
        '相关性要求',
        queries.map((item) => ({ text: item.task_name + '：' + (item.prompt || '（无）') })),
      ),
    ]),
  });

  const result = await searchRefImages(deps.context, queries);
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
    session.questions.push('参考图检索未成功（' + result.reason + '），如果一致性要求高请手动上传参考图。');
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
        deps.emit(session, 'think', image.id + ' 想要的参考图「' + ref + '」没搜到可用图片，已忽略', {
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
// 检索来的候选和规划直接给的公网地址走同一条下载 + 判定链路，只是后者不做相关性判定。
function refEntities(session, hits, queries) {
  const requirementOf = new Map();
  for (const item of queries) requirementOf.set(item.task_name, item.prompt || '');
  const entities = [];
  const byHead = new Map();
  for (const hit of hits) {
    const pool = (hit.candidates || []).filter((item) => item && item.url);
    if (!pool.length) continue;
    const head = pool[0].url;
    const existing = byHead.get(head);
    // 两个实体搜到同一批图时合并成一个，登记阶段再把 task_name 记成别名。
    if (existing) {
      if (hit.task_name && existing.taskNames.indexOf(hit.task_name) < 0) existing.taskNames.push(hit.task_name);
      continue;
    }
    const entity = {
      key: 'q' + entities.length,
      taskNames: hit.task_name ? [hit.task_name] : [],
      query: hit.query,
      note: hit.query,
      requirement: requirementOf.get(hit.task_name) || '',
      pool,
      cursor: 0,
      searches: 0,
      queried: new Set([hit.query]),
      seen: new Set(pool.map((item) => item.url)),
      direct: false,
    };
    byHead.set(head, entity);
    entities.push(entity);
  }
  const directSeen = new Set();
  for (const image of session.images) {
    for (const ref of image.spec.refs || []) {
      if (typeof ref !== 'string' || !/^https?:\/\//i.test(ref) || directSeen.has(ref)) continue;
      directSeen.add(ref);
      entities.push({
        key: 'u' + entities.length,
        taskNames: [],
        query: ref,
        // 规划可能给好几张地址，都叫"规划给出的地址"在时间线上分不清谁是谁，带上文件名。
        note: '规划给出的 ' + shortUrlLabel(ref),
        requirement: '',
        pool: [{ url: ref, title: '', source: ref }],
        cursor: 0,
        searches: 0,
        queried: new Set(),
        seen: new Set([ref]),
        direct: true,
      });
    }
  }
  return entities.slice(0, DEFAULTS.refDownloadLimit);
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
async function gateRefCandidates(session, entity, usable, deps, attempt) {
  if (entity.direct) return { entry: usable[0].entry, reason: '规划直接指定，不再判定' };
  if (usable.length === 1 && !entity.requirement) {
    return { entry: usable[0].entry, reason: '只有一张可用' };
  }
  await mkdir(deps.dirs.sheets, { recursive: true });
  const sheetPath = join(deps.dirs.sheets, 'cand-' + entity.key + '-' + attempt + '.png');
  let built = null;
  try {
    built = await review.buildGridSheet(
      usable.map((item, index) => ({ path: item.entry.path, label: String(index + 1) })),
      sheetPath,
      { perRow: Math.min(3, usable.length) },
    );
  } catch {
    built = null;
  }
  // 拼图失败就别浪费一次模型调用，直接用第一张能解码的。
  if (!built || !built.items.length) return { entry: usable[0].entry, reason: '候选拼图失败，取第一张可用图' };
  // buildGridSheet 会跳过解不开的图，标签顺序和 usable 下标要重新对齐。
  const order = built.items.map((item) => usable.findIndex((row) => row.entry.path === item.path));

  const instruction = [
    '你是参考图筛选节点。候选图已经由程序拼成一张材料图，你只要打开它、看、给结论。',
    '',
    '要找的东西：' + entity.note,
    '相关性要求：' + (entity.requirement || '（无额外要求，能清楚看到目标即可）'),
    '',
    '候选材料图：' + sheetPath,
    '  共 ' + order.length + ' 张，从左到右编号 ' + order.map((_, index) => index + 1).join('、') + '，每张左上角有数字标签。',
    '',
    '判定规则（严格照做）：',
    '1. 人物必须是本人、面部清晰可辨识；车型 / logo 必须是同一款。',
    '2. 这些情况一律不要选：不是本人或不是同一款、糊、严重遮挡、纯文字截图、大面积水印、明显是插画或表情包。',
    '3. 拿不准就不选。宁可这一批全否，也不要塞一张错的参考图进生成。',
    '4. 不要写脚本、不要裁图量像素、不要联网搜索、不要打开其它文件。只 read 上面这一张材料图。',
    '5. 工具调用上限 2 次，看完立刻给结论。',
    '',
    '只输出一个 JSON 对象，不要解释、不要 markdown 代码块：',
    '{"pick":1,"reason":"不超过 30 字"}',
    '  pick 填 1..' + order.length + ' 里最合适那张的编号；全都不符合要求就填 0。',
  ].join('\n');

  let data;
  try {
    ({ data } = await deps.agent.runJson(session, { step: 'think', instruction, maxTools: 2 }));
  } catch {
    return { entry: usable[0].entry, reason: '判定节点异常，取第一张可用图' };
  }
  const reason = asText(data.reason).slice(0, 60);
  const pick = Number(data.pick);
  if (!pick || pick < 1 || pick > order.length) return { entry: null, reason: reason || '都不符合要求' };
  const index = order[pick - 1];
  if (index < 0) return { entry: null, reason: reason || '都不符合要求' };
  return { entry: usable[index].entry, reason: reason || '符合要求' };
}

// 一批候选：下载到缓存 -> 机械过滤（缓存模块做）-> 相关性判定。
// 每次只取 refBatch 张：一批 3 张足够挑出一张能用的，全下既慢又把时间线塞满。
async function reviewRefBatch(session, entity, batch, deps, attempt) {
  const startedAt = Date.now();
  const cache = cacheOf(deps);
  // 检索来的候选是第三方地址，不许指向本机或内网；规划直接给的地址来自用户需求，按接口地址的规则放行。
  const fetched = await Promise.all(batch.map((item) => cache.download(item.url, { publicOnly: !entity.direct })));
  const usable = [];
  fetched.forEach((entry, index) => {
    if (entry.ok) usable.push({ entry, meta: batch[index] });
  });

  const verdict = usable.length ? await gateRefCandidates(session, entity, usable, deps, attempt) : null;
  const pickedPath = verdict && verdict.entry ? verdict.entry.path : '';

  const rows = fetched.map((entry, index) => {
    const meta = batch[index];
    if (!entry.ok) {
      return {
        key: '',
        title: meta.title || '（无标题）',
        note: meta.source || meta.url,
        tag: 'warn',
        text: '下载失败：' + entry.error,
      };
    }
    const chosen = entry.path === pickedPath;
    return {
      key: 'cache/' + entry.file,
      title: meta.title || '（无标题）',
      note: meta.source || meta.url,
      tag: chosen ? 'pass' : 'fail',
      text: chosen ? '已选用' : '不符合要求',
    };
  });

  let headline;
  if (verdict && verdict.entry) headline = entity.note + '：从 ' + batch.length + ' 张候选里选定 1 张';
  else if (usable.length) headline = entity.note + '：' + usable.length + ' 张候选都不符合要求，继续找';
  else headline = entity.note + '：这一批 ' + batch.length + ' 张候选都没下载成功，继续找';

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

  if (!verdict || !verdict.entry) return null;
  return { path: verdict.entry.path, file: verdict.entry.file, url: verdict.entry.url, reason: verdict.reason };
}

// 候选池用完了：换个说法再搜一轮。原查询通常太"描述性"，搜索引擎更吃"实体名 + 官方图"。
async function searchMoreCandidates(session, entity, deps) {
  if (entity.direct || entity.searches >= DEFAULTS.refSearchRounds) return [];
  const query = broadenQuery(entity.query, entity.searches);
  if (!query || entity.queried.has(query)) return [];
  entity.queried.add(query);
  entity.searches += 1;
  deps.emit(session, 'think', entity.note + '：候选用完了，换个说法再搜（' + query + '）', { level: 'warn' });
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
  entity.pool.push(...fresh);
  return fresh;
}

async function resolveEntityRef(session, entity, deps) {
  for (let attempt = 0; attempt < DEFAULTS.refGateRounds; attempt += 1) {
    let batch = entity.pool.slice(entity.cursor, entity.cursor + DEFAULTS.refBatch);
    entity.cursor += batch.length;
    if (!batch.length) {
      const more = await searchMoreCandidates(session, entity, deps);
      if (!more.length) return null;
      batch = entity.pool.slice(entity.cursor, entity.cursor + DEFAULTS.refBatch);
      entity.cursor += batch.length;
      if (!batch.length) return null;
    }
    const picked = await reviewRefBatch(session, entity, batch, deps, attempt);
    if (picked) return picked;
  }
  return null;
}

// 参考图：检索 -> 分批下载到缓存 -> 判定相关性 -> 合格才复制进会话并登记成 R1、R2…
// 存进会话而不是直接用缓存，是为了让生成端和评审端拿到同一份稳定素材。
async function materializeRefs(session, deps) {
  const queries = normalizeRefQueries(session.plan && session.plan.ref_queries);
  const hits = queries.length ? await runRefSearch(session, queries, deps) : [];
  const knownTasks = new Set(queries.map((item) => canonicalRef(item.task_name)).filter(Boolean));
  // 降级判定要用规划时写的原始 refs，映射之后就看不出来了。
  const plannedRefs = new Map();
  for (const image of session.images) plannedRefs.set(image.id, (image.spec.refs || []).slice());

  const entities = refEntities(session, hits, queries);
  if (!entities.length) {
    settleImageRefs(session, deps, plannedRefs, new Map(), new Map(), knownTasks);
    return;
  }

  const cache = cacheOf(deps);
  // 每轮会话最多清一次缓存，失败不影响主流程。
  if (cache.prune) await cache.prune();

  // 并发 2：下载是网络等待、判定是一次模型调用，再高会顶到运行时的 agentConcurrency。
  const resolved = new Map();
  let cursor = 0;
  const workers = Array.from({ length: Math.min(2, entities.length) }, async () => {
    while (cursor < entities.length) {
      const entity = entities[cursor];
      cursor += 1;
      try {
        const picked = await resolveEntityRef(session, entity, deps);
        if (picked) resolved.set(entity.key, picked);
      } catch (error) {
        deps.emit(session, 'think', entity.note + ' 参考图处理异常：' + String(error && error.message ? error.message : error), {
          level: 'warn',
        });
      }
    }
  });
  await Promise.all(workers);

  const byUrl = new Map();
  const byTask = new Map();
  const byPath = new Map();
  const reasons = new Map();
  const missed = [];
  for (const entity of entities) {
    const picked = resolved.get(entity.key);
    if (!picked) {
      missed.push({ tag: 'fail', text: entity.note });
      deps.emit(session, 'think', entity.note + '：没找到符合要求的参考图', { level: 'warn' });
      session.questions.push('「' + entity.note + '」没找到符合要求的参考图，如果一致性要求高请手动上传。');
      continue;
    }
    let id = byPath.get(picked.path);
    if (!id) {
      id = 'R' + (session.refs.length + 1);
      const file = id + (picked.file.endsWith('.png') ? '.png' : '.jpg');
      await copyFile(picked.path, join(deps.dirs.refs, file));
      session.refs.push({ id, file, path: join(deps.dirs.refs, file), note: entity.note, source: picked.url, origin: 'search' });
      byPath.set(picked.path, id);
    }
    reasons.set(id, picked.reason || '');
    byUrl.set(picked.url, id);
    for (const name of entity.taskNames) if (name) byTask.set(name, id);
  }

  settleImageRefs(session, deps, plannedRefs, byUrl, byTask, knownTasks);
  session.refSheet = null;
  if (!session.refs.length) {
    deps.emit(session, 'think', '没有可用的参考图，本轮全部按文生图走', { level: 'warn' });
    return;
  }
  deps.emit(session, 'think', '参考图就绪：' + session.refs.map((ref) => ref.id).join('、'), {
    detail: detail('参考图', [
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
  image.spec.prompt = target.prompt || image.spec.prompt;
  image.spec.entry = 'edit';
  // 只带编辑节点点名的参考图。把上一版的 R1..R4 一起留下，模型会分不清哪张是要改的底图，
  // 转而照着参考图重画一张全新的图——实测「加个标题」被画成了另一台车、另一个人、另一个背景。
  image.spec.refs = dedupe(target.refs || []);
  if (target.checklist && target.checklist.length) image.spec.checklist = target.checklist;
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
    parentPath: parent ? parent.path : null,
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
  await deliver(session, deps);
}

// ---------------------------------------------------------------- 01/02/03 规划

async function planNode(session, deps) {
  const startedAt = Date.now();
  deps.emit(session, 'plan', '规划中：分诊欠定项、决定要不要检索参考图、给每张图出规格', {
    detail: detail('规划节点 · 输入', [
      text('用户原话', session.instruction),
      kv('已登记参考图', session.refs.length ? session.refs.map((ref) => ref.id).join('、') : '无'),
      kv('工具调用预算', DEFAULTS.toolBudget.plan + ' 次（运行时硬中断）'),
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
    '2. 需求里出现真人、具体产品、logo、车型、地标这类“必须长成某个样子”的实体，而上面没有对应参考图时，',
    '   不要自己调工具检索——把检索意图写进顶层 ref_queries，系统会替你调搜图工具并下载到本地。',
    '   这是硬性分工：你只负责说清“要搜什么”，检索、下载、编号全部由运行时执行。',
    '   ref_queries 每项形如 {"task_name":"tokyo_tower","query":"东京塔 白天 正面 全景","prompt":"必须是东京塔本体的清晰全景照片，不要夜景灯光秀，不要局部特写"}：',
    '   - task_name：英文小写短名，本次规划内唯一；图片的 refs 就用这个名字引用检索结果。',
    '   - query：中文实体名 + 用途词（正面照 / 内饰 / 车标 / logo / 门店）。',
    '   - prompt：相关性过滤条件，写清楚要什么样的图。',
    '   - 一个实体一项，最多 6 项；上面已经登记成 R1、R2… 的实体不要重复写。',
    '   - 没有这类实体就写空数组，不要为了凑数硬编。',
    '3. 图片的 refs 只写三种值：已登记的 R 编号、ref_queries 里的 task_name、公网图片地址（http/https）。',
    '   三种系统都会归一成 R 编号并下载到本地；写别的字符串会被忽略并告警。',
    '4. 为每张要交付的图给出：id（大写字母，如 A、B）、slug、title、entry（t2i 或 edit）、aspect_ratio（如 "16:9"，拿不准用 "auto"）、slots、refs（引用 R 编号 / task_name / 图片地址）、text_layers（画面里必须出现的文字，没有就空数组）、checklist。',
    '4b. slug 是这张图的英文短名，直接当交付文件名用：全小写、单词之间用短横线、2-4 个词、只概括画面内容（主体 + 场景或动作），',
    '    例：orange-cat-on-windowsill、girl-and-cat-sleeping、shiba-under-tokyo-tower。不要写尺寸、风格、镜头语言，不要重复 id。',
    '    同一批图里 slug 必须互不相同——重名会导致交付文件互相覆盖。',
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
    '5b. 色彩是硬要求：style 槽位必须写清白平衡（例：中性白平衡、真实色彩还原，不要暖黄调）；',
    '   negative 槽位必须包含"整体偏红、偏暖发黄"。系统还会再追加一条固定的白平衡要求，不要重复抄。',
    '6. checklist 每项形如 {"id":"H1","kind":"hard","text":"...","verify":"vlm"}；hard 是必须满足的（主体与数量、图内文字、参考图一致性、用户点名要求），soft 是风格偏好。',
    '   hard 最多 4 条，而且只能来自用户原话里明确说过的东西——不要把自己想到的"最好也有"写成 hard。',
    '   每张图至少 1 条 hard。写不出 4 条就少写，不要凑数。',
    '   一条 hard 只写一个可判定条件，带多个限定词的必须拆开。评审是逐条核对的，复合条目会被"部分满足"蒙混过关：',
    '   反例「机位在车外左侧约45度，透过前挡风玻璃与驾驶位侧窗能清楚看到车内两人」——评审只核对了"车外"和"看到两人"就放行；',
    '   正例拆成两条「机位在车外左前方约45度，画面里能看到车头左前角与A柱」「透过前挡风玻璃与驾驶位侧窗能清楚看到车内两人」。',
    '   机位、角度、景别、构图这类必须各自单独成条，并写成"画面里能看到什么"这种可核对的事实，不要写成风格描述。',
    '   拆完超过 4 条时，把语义相邻的合并，但上面这类构图条目不要合并。',
    '6b. 姿势正确性：需求里出现手语/手势、瑜伽或健身体式、乐器指法、舞蹈或武术动作、',
    '    攀岩抓点、握笔握筷这类「必须摆成某个特定姿势」的内容时，每个姿势单独写一条 hard，',
    '    而且必须写成「姿势本身对不对」，不是「图上有没有对应的文字标签」。',
    '    反例（错）：「画面里出现文字「A」」——图上印着 A 就过，手型完全不对也照样放行；',
    '    正例（对）：「A 格里的手型确实是 ASL 字母 A：握拳、拇指贴在食指外侧，其余四指收拢」。',
    '    这类需求里文字标签是次要的：先保证姿势正确，标签只写进 text_layers，不要占用 hard 名额。',
    '    同一张图里姿势多于 4 个时，按组分条（例：「A-E 五格手型分别符合 ASL 对应字母」），',
    '    但仍然必须是 hard，不许降级成 soft。',
    '7. 默认 4K：除非用户明确要别的尺寸，area 一律写 "4K"。',
    '8. route：需求简单、只出 1 张图写 "fast"；多图或有参考图/文字/一致性要求写 "full"。',
    '8b. 主体一致性（多图专用）：images 达到 2 张，且同一个主体（人物 / 动物 / 拟人化物体）在 2 张以上的图里出现时，',
    '    必须输出 character_refs，为该主体单独出一张「角色设定图」，之后相关图全部以它为外观基准。',
    '    判据是"这个主体会不会被画成两个样子"：漫画分镜、绘本、系列海报、同一产品的多角度图要写；',
    '    四张不同风景、四个互不相干的产品不要写。',
    '    每项形如 {"key":"girl","note":"16 岁少女","prompt":"...","images":["A","B","D"]}；images 省略表示所有图都用它。',
    '    prompt 必须写成角色设定稿：纯净浅灰单色背景、主体全身正面居中站姿、柔和平光无强阴影、无文字无水印，',
    '    并把该主体的外观特征全部写死（脸型、发型与发色、眼睛、体型比例、服装款式与配色、标志性配件）。',
    '    最多 2 个主体。没有跨图重复主体时输出空数组 []。',
    '10. 规划阶段总工具调用上限 6 次，只用于 read 已登记的参考图。到达上限就用手上已有的信息出计划。',
    '',
    '只输出一个 JSON 对象，不要解释、不要 markdown 代码块：',
    '{"route":"full","think":["..."],"assumptions":["柴犬坐在长椅左侧，把右侧留给塔身，因为需求要同时看清狗和塔"],"questions":[],"character_refs":[{"key":"girl","note":"16 岁少女","prompt":"角色设定稿：纯净浅灰背景，全身正面居中站姿…","images":["A","B"]}],"ref_queries":[{"task_name":"tokyo_tower","query":"东京塔 白天 正面 全景","prompt":"必须是东京塔本体的清晰全景照片"}],"images":[{"id":"A","slug":"shiba-under-tokyo-tower","title":"...","entry":"t2i","aspect_ratio":"16:9","area":"4K",',
    ' "slots":{"style":"...","shot":"...","composition":"...","scene":"...","subject":"...","material":"...","light":"...","lens":"...","text":"","negative":"..."},',
    ' "refs":[],"text_layers":[],"checklist":[{"id":"H1","kind":"hard","text":"...","verify":"vlm"}]}]}',
  ].join('\n');

  const { data } = await deps.agent.runJson(session, { step: 'plan', instruction, maxTools: DEFAULTS.toolBudget.plan });
  session.plan = data;
  session.route = data.route === 'fast' ? 'fast' : 'full';
  const refQueries = normalizeRefQueries(data.ref_queries);
  const refQuerySummary = refQueries.length
    ? refQueries.map((item) => item.task_name + '：' + item.query).join('；')
    : '无（本轮不检索参考图）';
  session.think = Array.isArray(data.think) ? data.think : [];
  session.assumptions.push(...(Array.isArray(data.assumptions) ? data.assumptions : []).map((item) => String(item || '').trim()).filter(Boolean));
  session.blockers = normalizeBlockers(data.questions);
  session.images = normalizePlan(data, session);
  for (const image of session.images) {
    if (!image.spec.missingSlots || !image.spec.missingSlots.length) continue;
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
          kv('尺寸', image.spec.area + ' · ' + image.spec.aspectRatio),
          kv('参考图', image.spec.refs.length ? image.spec.refs.join('、') : '无'),
          image.blocked ? kv('阻塞原因', image.blockReason) : null,
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
  return list.map((raw, index) => {
    let id = String(raw.id || String.fromCharCode(65 + index)).toUpperCase().slice(0, 4);
    while (used.has(id)) id += '1';
    used.add(id);
    const refs = Array.isArray(raw.refs) ? raw.refs.filter(Boolean) : [];
    const textLayers = Array.isArray(raw.text_layers) ? raw.text_layers : [];
    const subjectText = [raw.title, raw.prompt, raw.slots && raw.slots.subject, raw.slots && raw.slots.scene]
      .filter(Boolean)
      .join(' ');
    const checklist = normalizeChecklist(raw.checklist, textLayers, subjectText);
    const questions = (Array.isArray(raw.questions) ? raw.questions : [])
      .map((item) => (typeof item === 'string' ? item : (item && (item.text || item.question)) || ''))
      .filter(Boolean);
    const hasSlots = Boolean(raw.slots && typeof raw.slots === 'object');
    const slots = hasSlots ? normalizeSlots(raw.slots, textLayers) : null;
    const composed = composePrompt(slots, raw.prompt, session.instruction, hasSlots);
    return {
      id,
      title: raw.title || '图 ' + id,
      blocked: Boolean(raw.blocked) || questions.length > 0,
      blockReason: questions.join('；'),
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
        checklist,
      },
      rounds: [],
      status: 'pending',
      chosen: null,
    };
  });
}

// 文字层硬项上限。文字标签只是辅助信息，一条一条挂 hard 会把 hard 名额吃光，
// 反而把 planner 写的「手型对不对」这类真正的要求挤出局（真机 20261110-5e10ae：
// A 图 26 个字母标签生成 26 条 T 项，T1-T5 占满 hard 名额，4 条手型检查全被降级成
// soft，soft 不参与放行，于是「手指摆成印刷体字母」照样判通过）。
// 超过上限的部分合并成一条聚合项，仍然可判定，但只占一个名额。
const MAX_TEXT_HARD = 3;

function normalizeChecklist(checklist, textLayers, subjectText) {
  const items = Array.isArray(checklist) ? checklist : [];
  // 文字层是用户明确点名的可验证项，排在最前面，保证不会被 hard 上限截掉；
  // 但数量必须封顶，否则它会把 planner 写的语义要求全部挤出去。
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
  for (const item of items) {
    if (!item || !item.text) continue;
    const text = String(item.text);
    if (out.some((existing) => existing.text === text)) continue;
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
  return limited;
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
  const maxRefine = session.route === 'fast' ? DEFAULTS.maxRefineFast : DEFAULTS.maxRefine;
  image.status = 'running';
  let action = image.pendingAction || {
    type: image.spec.entry === 'edit' ? 'edit' : 'generate',
    prompt: image.spec.prompt,
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
  let lastActionType = action.type;

  for (let round = 0; round <= maxRefine; round += 1) {
    if (isCancelled(session)) return;
    // 底图在这一步就解析好：轨迹必须显示真正送进模型的那张图，
    // 不能显示一个解析不到的 id，否则「在 A-r1-g1 上编辑」会骗人。
    const parent = resolveParent(image, action);
    const requestedParentId = action.parentId || null;
    if (action.type === 'edit') {
      action.parentId = parent ? parent.id || action.parentId : null;
      action.parentPath = parent ? parent.path : null;
      action.parentStats = (parent && parent.program && parent.program.stats) || action.parentStats || null;
    }
    const record = { index: round, action: summarizeAction(action), candidates: [], startedAt: Date.now() };
    image.rounds.push(record);
    deps.emit(session, 'paint', image.id + ' 第 ' + (round + 1) + ' 轮：' + describeAction(action), {
      detail: detail('本轮动作', [
        kv('类型', action.type !== 'edit' ? '重新生成' : parent ? '在已有图上编辑' : '按参考图生成'),
        kv('底图', action.type !== 'edit' ? '无' : parent ? parent.id || '上一张' : '没找到，已退化成按参考图生成'),
        kv('参考图', (action.refs || []).join('、') || '无'),
        kv('候选数', session.route === 'fast' ? 1 : DEFAULTS.candidates),
        text('送进模型的 prompt', action.prompt),
      ]),
    });

    let candidates = [];
    try {
      candidates = await executeAction(session, image, action, deps);
    } catch (error) {
      record.error = describeError(error);
      image.failReason = record.error;
      deps.emit(session, 'paint', image.id + ' 生成失败：' + record.error, { level: 'error' });
      if (isFatal(error)) {
        session.status = 'failed';
        session.fatal = record.error;
        image.status = 'failed';
        return;
      }
      // 安全审核拒绝没有重试价值：prompt 一个字没改，再送 5 次也是同样的 422。
      // 立刻停手，把接口原文和「怎么改」一起顶到对话层，让用户改需求重来。
      if (isContentPolicy(error)) {
        image.status = 'failed';
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
        return;
      }
      if (round >= maxRefine) break;
      action = { type: 'generate', prompt: image.spec.prompt, refs: image.spec.refs, parentId: null };
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
          ? { ...action, prompt: withColorRetry(action.prompt) }
          : { type: 'generate', prompt: withColorRetry(image.spec.prompt), refs: image.spec.refs, parentId: null };
        continue;
      }
      judgeStartedAt = Date.now();
      verdict = await judgeNode(session, image, record, deps);
      record.verdict = verdict.summary;
    } catch (error) {
      const message = describeError(error);
      record.error = message;
      deps.emit(session, 'verify', image.id + ' 第 ' + (round + 1) + ' 轮评审异常：' + message, { level: 'error' });
      if (isFatal(error)) {
        session.status = 'failed';
        session.fatal = message;
        image.status = 'failed';
        return;
      }
      // 用户主动停的，别再自顾自重试。
      if (session.status === 'cancelled') return;
      if (round >= maxRefine) break;
      action = { type: 'generate', prompt: image.spec.prompt, refs: image.spec.refs, parentId: null };
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
    if (round >= maxRefine) break;

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
    }
    if (next.type === 'edit') {
      fullEdits += 1;
      if (fullEdits > DEFAULTS.maxFullEdits) {
        deps.emit(session, 'refine', image.id + ' 全图 edit 已达上限 ' + DEFAULTS.maxFullEdits + ' 次，改走重新生成');
        next = { type: 'generate', prompt: next.prompt || image.spec.prompt, refs: image.spec.refs, parentId: null };
      }
    }
    lastActionType = next.type;
    action = next;
  }

  await selectBestEffort(session, image, deps);
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
  let best = null;
  for (const round of image.rounds) {
    for (const candidate of round.candidates || []) {
      if (!candidate || !candidate.path) continue;
      if (!best) {
        best = candidate;
        continue;
      }
      const av = candidate.verdict || { hardPassed: 0, quality: 0 };
      const bv = best.verdict || { hardPassed: 0, quality: 0 };
      if (av.hardPassed > bv.hardPassed || (av.hardPassed === bv.hardPassed && av.quality > bv.quality)) best = candidate;
    }
  }
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
  return next.type === 'give_up';
}

async function executeAction(session, image, action, deps) {
  // 计量覆盖整个 DiT 环节：参考图上传 + 接口调用 + 图片下载。
  // 之前 started 写在接口调用之后，把最贵的那段漏掉了。
  const started = Date.now();
  const config = deps.config;
  const n = session.route === 'fast' ? 1 : DEFAULTS.candidates;
  const options = {
    prompt: action.prompt,
    aspectRatio: image.spec.aspectRatio,
    area: image.spec.area,
    n,
  };
  if (image.spec.size) options.size = image.spec.size;

  let result;
  let parent = null;
  let endpoint = 'images/generations';
  if (action.type === 'edit') {
    endpoint = 'images/edits';
    parent = resolveParent(image, action);
    const refs = [];
    // 父图是本地文件，必须先上传换成 mm_file://。直接把它当 image_url 发出去，
    // 接口会回 HTTP 400「only http(s) URL, data:image/*;base64 or mm_file:/」。
    if (parent) refs.push(await h3.resolveReference(config, parent.path));
    // 编辑只带动作里点名的参考图。fallback 到 image.spec.refs 会把上一版的 R1..R4 全塞进来，
    // 模型分不清哪张是底图，就会照着参考图重画。
    refs.push(...(await resolveActionRefs(session, image, action.refs, deps)));
    if (!refs.length) throw new Error('edit 缺少可用参考图');
    // 同时送底图和身份参考图时，必须说清谁是谁：不说的话模型会拿参考图当底图重画。
    if (parent && refs.length > 1) {
      options.prompt =
        '第 1 张图是要修改的原图，请在它基础上修改，保持它的构图、背景、光线与画幅不变；' +
        '后面的图只是身份/外观参考，不要采用它们的背景、机位或构图。\n\n' +
        options.prompt;
    }
    result = await h3.edit(config, { ...options, images: refs.slice(0, 16) });
  } else {
    // refine 点名的 refs 不能把角色基准图顶掉：修一轮之后主体就漂回原样了。
    const explicit = action.refs && action.refs.length ? action.refs : image.spec.refs || [];
    const refIds = dedupe([...explicit, ...(image.spec.characterRefs || [])]);
    const refs = await resolveActionRefs(session, image, refIds, deps);
    if (refs.length) {
      endpoint = 'images/edits';
      // 角色基准图是"没有底图的条件图"：不说清楚，模型会连它的浅灰背景一起照搬过来。
      if (!parent && (image.spec.characterRefs || []).length) {
        options.prompt =
          '参考图只用于锁定主体的身份与外观（脸型、发型与发色、眼睛、体型比例、服装款式与配色、标志性配件），' +
          '必须在所有图里保持完全一致；不要采用参考图的背景、场景、构图、机位与画幅。\n\n' +
          options.prompt;
      }
      result = await h3.edit(config, { ...options, images: refs.slice(0, 16) });
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
      parentPath: parent ? parent.path : null,
      // 统计值在 parent.program.stats 上（programChecks 写进去的），候选对象本身没有 stats 字段。
      // 写成 parent.stats 会恒为 undefined：漂移判定永远退回绝对模式，自动配平阈值从
      // 「相对父图 ≥0.05」变成「绝对 redGain ≥1.35」，编辑把画面推红也就没人拉回来了。
      parentStats: (parent && parent.program && parent.program.stats) || action.parentStats || null,
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
      candidates[0] && candidates[0].revisedPrompt
        ? text('模型改写后的 prompt', candidates[0].revisedPrompt)
        : null,
    ]),
  });
  return candidates;
}

// 参考图引用只认两种：已登记的 R 编号（换成会话目录里的文件），以及能直接交给接口的地址。
// 其余字符串一律返回空串，由调用方跳过并告警。refs 来自 Agent 的回复，是不可信输入：
// 以前不认识的字符串会原样当成本地路径，于是 uploadReference 会把那个本机文件读出来上传给接口。
function resolveRefPath(session, ref) {
  if (typeof ref !== 'string' || !ref) return '';
  if (/^(https?:\/\/|mm_file:\/\/|data:image\/)/i.test(ref)) return ref;
  const found = session.refs.find((item) => item.id === ref.toUpperCase());
  return found ? found.path : '';
}

// 把一组引用解析成接口能用的参考图；不认识的跳过并在时间线上说一句。
async function resolveActionRefs(session, image, list, deps) {
  const out = [];
  for (const ref of list || []) {
    const target = resolveRefPath(session, ref);
    if (!target) {
      deps.emit(session, 'paint', image.id + ' 忽略了不认识的参考图引用「' + String(ref).slice(0, 60) + '」', {
        level: 'warn',
      });
      continue;
    }
    out.push(await h3.resolveReference(deps.config, target));
  }
  return out;
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

// 05 VERIFY 的程序部分：尺寸、色彩漂移（发红）、过度锐化、文字层是否写进 prompt。
async function programChecks(session, image, candidate, deps) {
  let decoded = null;
  try {
    // 复用下载时拿到的字节，省掉一次 4K 图的磁盘读 + 解码。
    // 必须走 decodeImage（PNG/JPEG 都认），不能只认 PNG：见文件头的说明。
    decoded = decodeImage(candidate.buffer || (await readFile(candidate.path)));
  } catch (error) {
    candidate.buffer = null;
    candidate.program = { error: '图片解码失败：' + String(error && error.message ? error.message : error) };
    candidate.checks = [{ id: 'P-decode', kind: 'hard', verify: 'program', text: '图片可正常解码', result: 'fail' }];
    return;
  }
  candidate.buffer = null;
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
  };

  // 色彩只做检测，不动像素：偏红由 H-color 硬项判 fail，交给 runImage 重画。
  // 偏红不再用像素配平去救。实测 matchBalance 在「子图比父图亮」时三通道增益会一起撞到
  // clamp 下限（[0.75,0.75,0.75]），退化成整体压暗：色偏一点没修，还把用户明确要的亮度
  // 压回去（真机 20261109-691283「改成烈日当空」那一轮，luma 被压到 ×0.748）。
  // 现在程序层只负责判，判成偏红就由 runImage 打回重画一轮。
  const redCast = stats.redGain >= RED_ABS_LIMIT && (drift.cast === 'red' || stats.redGain >= RED_HARD_LIMIT);
  candidate.program.redCast = redCast;

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
      : '整体白平衡中性（redGain ' + stats.redGain + '）',
    result: redCast ? 'fail' : 'pass',
  });
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
      list(
        '校验项',
        checks.map((check) => ({ tag: check.result, text: check.id + ' · ' + check.text })),
      ),
    ]),
  });
  await prepareAssets(candidate, decoded, deps);
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
          '；过曝像素占比 ' + (program.stats.clippedRatio !== undefined ? program.stats.clippedRatio : '未知'),
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
    '7. 工具调用上限 ' + DEFAULTS.judgeToolBudget + ' 次：每个候选的材料图 + 参考图材料，看完立刻给结论。',
    '8. 你看不到送进模型的 prompt，只能看图。',
    '9. 先把所有候选判完，再决定 next。',
    '10. note 不超过 30 字，summary 不超过 40 字。',
    '11. extra_fails 是「清单没写、但你一眼看出违背用户原话」的问题，按 hard fail 处理：',
    '    典型是姿势/手型/指法不对、动作雷同、该出现的东西没出现、人物明显不像。',
    '    每项形如 {"candidateId":"...","text":"第3格的 H 手型不是 ASL 的 H"}，写清在第几块能看出来。',
    '    硬性要求：只要你在 summary 或 note 里写了「手型不对」「姿势不准」「略偏」「雷同」「没画出来」',
    '    这类话，就必须把同一条写进 extra_fails——不许只在 summary 里吐槽完就给 pass。',
    '    反过来也确实拿不准的（看不清、分辨率不够）不要写进 extra_fails。',
    '',
    '历史动作（判完候选后再看，只用于决定 next）：',
    history || '（首轮）',
    '',
    '只输出一个 JSON 对象，不要解释、不要 markdown 代码块：',
    '{"verdicts":[{"candidateId":"' + candidates[0].id + '","checks":[{"id":"H1","result":"pass|fail|uncertain","note":"..."}],"quality":7.5,"summary":"..."}],',
    ' "extra_fails":[{"candidateId":"' + candidates[0].id + '","text":"清单外但违背用户原话的问题"}],',
    ' "next":{"type":"regenerate|edit|give_up","candidateId":"...","prompt":"给模型的中文编辑或生成指令","reason":"..."}}',
    '',
    '如果所有候选的 hard 项都通过，next 直接写 {"type":"give_up"}。',
  ].join('\n');

  const { data } = await deps.agent.runJson(session, { step: 'judge', instruction, maxTools: DEFAULTS.toolBudget.judge });
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

async function refineNode(session, image, record, verdict, deps, forceChange) {
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
    image.spec.prompt,
    '',
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
    '',
    '只输出一个 JSON 对象：',
    '{"type":"regenerate|edit|give_up","candidateId":"...","prompt":"给模型的具体指令","reason":"..."}',
  ].join('\n');

  const startedAt = Date.now();
  const { data } = await deps.agent.runJson(session, { step: 'refine', instruction, maxTools: DEFAULTS.toolBudget.refine });
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
    const best = (round.candidates || []).slice().sort((a, b) => {
      const av = a.verdict || { hardPassed: 0, quality: 0 };
      const bv = b.verdict || { hardPassed: 0, quality: 0 };
      return bv.hardPassed - av.hardPassed || bv.quality - av.quality;
    })[0];
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
  const shuffled = pool.slice().sort(() => Math.random() - 0.5).slice(0, 4);
  // 选优同样只看一张并排对比图：顺序打乱、不给分数，避免评审被历史结论带偏。
  let sheetPath = '';
  try {
    await mkdir(deps.dirs.sheets, { recursive: true });
    const built = await review.buildGridSheet(
      shuffled.map((candidate, index) => ({ path: candidate.path, label: String(index + 1) })),
      join(deps.dirs.sheets, image.id + '-select-sheet.png'),
      { perRow: Math.min(shuffled.length, 4) },
    );
    sheetPath = built.sheet;
  } catch {
    sheetPath = '';
  }
  const instruction = [
    '你是H3-Image-Executor 的选优节点。下面几张图来自不同轮次，历史评分不完全可比，请只看图并排对比后选一张交付。',
    '',
    '用户原话：',
    session.instruction,
    '',
    sheetPath
      ? '对比图（只 read 这一张，从左到右、从上到下依次编号，左上角有编号标签）：\n  ' + sheetPath +
        '\n  编号对应：' + shuffled.map((candidate, index) => (index + 1) + '=' + candidate.id).join('，')
      : '候选（本地绝对路径，必须用 read 逐张打开看）：\n' +
        shuffled.map((candidate, index) => '候选' + (index + 1) + ' -> ' + candidate.path).join('\n'),
    '',
    '不要写脚本、不要裁图、不要量像素。看图直接选，按用户原话判断哪张最合适，写明理由。',
    '工具调用上限 2 次。只输出 JSON：',
    '{"choice":1,"reason":"..."}',
  ].join('\n');
  try {
    const { data } = await deps.agent.runJson(session, { step: 'select', instruction, maxTools: DEFAULTS.toolBudget.select });
    const index = Math.max(0, Math.min(shuffled.length - 1, Number(data.choice || 1) - 1));
    image.chosen = shuffled[index];
    image.chosenReason = data.reason || '';
  } catch {
    image.chosen = shuffled[0];
    image.chosenReason = '选优节点失败，按验收分数回退';
  }
  image.status = 'unpassed';
  deps.emit(session, 'select', image.id + ' 选优交付：' + image.chosen.id + '（' + image.chosenReason + '）', {
    detail: detail('选优', [
      kv('候选池', pool.map((candidate) => candidate.id).join('、')),
      kv('送进对比图的顺序', shuffled.map((candidate, index) => (index + 1) + '=' + candidate.id).join('，')),
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
      fromDelivery: true,
    };
  }
  return null;
}

async function editPlanNode(session, instruction, deps) {
  const inventory = session.images
    .map((image) => {
      const chosen = image.chosen || lastDelivered(session, image, deps);
      return image.id + '「' + image.title + '」' + (chosen ? ' 当前交付 ' + chosen.id + ' -> ' + chosen.path : '（无交付）');
    })
    .join('\n');
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
    session.refs.map((ref) => ref.id + ' -> ' + ref.path).join('\n') || '（无）',
    '',
    '做指代解析：改哪张图、改哪部分、哪些必须不变。给出：目标图 imageId、要编辑的候选 candidateId（用当前交付的那张）、',
    '给模型的编辑指令 prompt（只描述要改的地方和必须保持不变的部分）、以及这次新的验收清单 checklist。',
    '',
    'refs 只在需要引入原图里没有的新实体时才写（例如"把柴犬换成橘猫"），写 R 编号或公网图片地址。',
    '只是加文字、挪位置、调色这类改动，refs 一律留空——多塞参考图会让模型照着参考图重画一张全新的图。',
    'prompt 里不要用"这张图""原图"以外的模糊指代，直接说要改什么、什么必须保持不变。',
    '',
    '只输出 JSON：',
    '{"imageId":"A","candidateId":"A-r1-g0","prompt":"...","refs":[],"keep":["..."],"checklist":[{"id":"H1","kind":"hard","text":"...","verify":"vlm"}]}',
  ].join('\n');
  const { data } = await deps.agent.runJson(session, { step: 'edit', instruction: prompt, maxTools: DEFAULTS.toolBudget.edit });
  if (!data || !data.imageId) return null;
  return {
    imageId: String(data.imageId).toUpperCase(),
    candidateId: data.candidateId || null,
    prompt: data.prompt || instruction,
    refs: Array.isArray(data.refs) ? data.refs : [],
    checklist: Array.isArray(data.checklist) && data.checklist.length
      ? normalizeChecklist(data.checklist, [], String(data.prompt || ''))
      : null,
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
    ].join('\n');

    // 预算 4 次：对比图、基准图材料、必要时核对原图，一次收尾。实测 3 次会在读基准图时就被打断。
    const { data } = await deps.agent.runJson(session, { step: 'cross', instruction, maxTools: 4 });
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
  for (const image of session.images) {
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
    // 交付文件名：H3-Image_<内容英文简写>_<时间戳>.<真实格式>。
    // 规划节点给的 slug 可能重复（同一个主体出现在多张图里），重名会互相覆盖，这里补序号。
    const chosenExt = extensionFor(await readFile(image.chosen.path));
    const slug = normalizeSlug(image.spec && image.spec.slug, String(image.id).toLowerCase());
    let base = 'H3-Image_' + slug + '_' + stampText;
    for (let n = 2; usedNames.has(base); n += 1) base = 'H3-Image_' + slug + '-' + n + '_' + stampText;
    usedNames.add(base);
    const deliverName = base + chosenExt;
    const previewName = base + '-preview.png';
    const target = join(dir, deliverName);
    await copyFile(image.chosen.path, target);
    const preview = join(dir, previewName);
    if (image.chosen.preview) await copyFile(image.chosen.preview, preview);
    items.push({
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
    });
  }
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
    questions: session.questions,
    crossCheck: cross,
    cost: session.cost,
  };
  await writeFile(join(dir, 'report.json'), JSON.stringify(report, null, 2));
  session.delivery = {
    version,
    dir,
    items,
    questions: session.questions.slice(),
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
      questions: session.questions.slice(),
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
    session.status = session.fatal ? 'failed' : 'delivered';
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
      list('待你确认', session.questions.map((item) => ({ text: item, tag: 'warn' }))),
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
  };
}

function describeAction(action) {
  if (!action) return '未知动作';
  if (action.type === 'edit') {
    if (action.parentPath) return '在 ' + (action.parentId || '上一张') + ' 上编辑';
    return '按参考图生成（没有可用底图）';
  }
  if (action.type === 'generate') return '重新生成';
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
