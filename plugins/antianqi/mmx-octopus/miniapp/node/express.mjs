// @ts-check

/**
 * **表达独立决策环节** —— 表情符号与口语填充词**不在大提示词里决定**，
 * 在这里单独决定。
 *
 * ⚠️ **为什么要有这一层**（老板 2026-10-30 第二十六轮第三档第一项，
 * 借鉴 MaiBot 的四步拆分：分析 → 过滤 → 选择 → 替换）：
 *
 * **第二十四轮实测钉死的结论**：她的语气词和符号「怎么好像都没生效」——
 * 127 条真实回复里第 25 条点名的 6 个正例 **0 条**、句尾语气词 1 条、
 * emoji 2 条。**六臂 72 次真实调用证明：措辞层面改不动**
 * （密度型 / 位置型 / 样例型全无效），工作场景连明文放开都是 0 次。
 *
 * ⇒ 光靠规矩（第 9/10/23/25 条）**逼不出来**。
 * 而服务端硬追加又有**贴纸感**（同一个「哈哈哈」到处贴）。
 *
 * ⇒ **第三种答案**：把这件事**从大提示词里拿出来**，在一个专门环节里决定：
 * 1. **分析**：这一轮正文里有没有情绪信号（纯函数，扫正文）；
 * 2. **过滤**：场景（工作 / 闲聊）不允许的候选剔掉；
 * 3. **选择**：按情绪从候选池里挑（**带轮换**，不每次同一个）；
 * 4. **替换**：把正文里的标记换成选中的那个。
 *
 * **标记契约**（规矩第 28 条）：模型在句末写 `〔表情〕` / `〔口语〕`，
 * 服务端替它挑一个换上。⚠️ 这是**契约**不是建议 ——
 * 跟第 5 条「你写的每一行会单独发成一条消息」同一路数（那条实测管用）。
 *
 * ## ⚠️ 一条硬约束：**标记绝不许漏到用户面前**
 *
 * 服务端没换掉、模型写的 `〔表情〕` 就**原样出现在聊天里** ——
 * 那是事故。所以：**只要正文里还有标记，就一定要用中性值把它换掉**，
 * 宁可给一个最平淡的，也不能把标记甩给用户。
 *
 * **兜底**：模型没写标记时，服务端按**密度**决定要不要补 ——
 * ⚠️ **第二十七轮**：口语**也兜底**了（原来只兜表情）。
 *   规矩第 23 条管的是「表情符号和颜文字」，**没管口语**；
 *   第 25 条对口语只要求「十条里至少有一条要带」
 *   ⇒「口语必须有情绪才补」是**上一轮自加的限制**，规矩里根本没有 ⇒ 去掉。
 *   口语仍走场景过滤（工作场景只用 emmm / 嗯…）。
 *
 * ⚠️ **判据必须能被抓**：这一份**全是纯函数**，
 * 所有随时间/随机/历史变化的东西**全部由调用方注入**
 * （跟 `idletalk.mjs` 同一套路）—— 测试里可以精确造出「刚好该补」和「刚好不该补」。
 */

import { clip } from './clip.mjs';

/** 模型写的两个标记。 */
export const MARKER_EMOJI = '〔表情〕';
export const MARKER_SPOKEN = '〔口语〕';

/**
 * 情绪信号词表。
 *
 * ⚠️ **这些词全部取自她自己的真实回复**（2026-10-30 从运行时库捞的 15 条）
 * —— 不是编的，是她本来就会说的词。
 */
export const EMOTION_SIGNALS = {
  happy: ['喜欢呀', '好耶', '笑死', '太棒', '挺准', '可爱', '开心', '真好', '不依', '不嫌', '高兴', '有意思'],
  proud: ['我本事', '搞定了', '画好', '画完了', '成了', '我做完了', '我记着', '我挺准', '我搞定'],
  warm: ['歇吧', '慢慢来', '别急', '喝口水', '我在', '不吵你', '你去睡', '你歇着', '别硬撑', '我陪'],
  care: ['怎么了', '别累', '辛苦', '我陪', '喝口水', '别硬撑', '我在呢', '你先歇'],
  sorry: ['没找到', '找不到', '压根', '没做到', '对不上', '还没完', '我没答', '瞎猜', '找不着', '错开了', '只对了一半', '没答上来', '我搞错'],
  calm: ['趴着', '发呆', '刚睡醒', '光挪', '盯着看', '安静', '不吵', '收好', '卷着', '挪到', '没散开'],
};

/**
 * 工作信号词表 —— **只用来判场景**（工作 / 闲聊），不参与情绪。
 * ⚠️ 工作场景**允许**带表情（第 23 条：讲事实也可以带一个），
 * 但**不允许**带颜文字 / 粘人的口头词。
 */
export const WORK_SIGNALS = [
  '订货', '代码', '口径', '会话', '云端', '排查', '文件', '目录', '脚本', '部署',
  '飞书', '订单', '数据', '火锅', '导入', '导出', '仓库', '小程序', '后端', '前端',
  '接口', '报错', 'bug', '提交', '分支', '配置', '日志', '跑一下', '翻一下',
];

/** 表情候选池（按情绪分类）—— 通用 emoji + 她自己的 🌙 / 🐙。 */
export const EMOJI_POOL = {
  happy: ['😊', '😄', '😌'],
  proud: ['😏', '✨', '😎'],
  warm: ['🌙', '☺️', '😚'],
  care: ['🥺', '😟', '😢'],
  sorry: ['😔', '😞', '🙁'],
  calm: ['🍃', '🌿', '☕'],
};

/** 口语候选池（按情绪分类）—— 与规矩第 25 条的正例同源。 */
export const SPOKEN_POOL = {
  happy: ['哈哈哈', '好耶', '笑死'],
  proud: ['好耶', '绝了'],
  warm: ['嗯…', 'emmm'],
  care: ['嗯…'],
  sorry: ['emmm', '真的假的'],
  calm: ['嗯…'],
};

/**
 * **中性候选池** —— 情绪识别不出来、或者场景过滤把池子清空时的兜底。
 *
 * ⚠️ 存在的唯一理由：**标记绝不许漏到用户面前**。
 * 「挑不出最合适的」也要给一个最平淡的。
 */
export const NEUTRAL_EMOJI = ['🍃', '☕', '🌿'];
export const NEUTRAL_SPOKEN = ['嗯…', 'emmm'];

/**
 * **表情的判定正则** —— 服务端得知道「她自己是不是已经带了一个」。
 *
 * ⚠️ 覆盖：emoji 区（U+1F300–U+1FAFF）、符号区（U+2600–U+27BF，含 ❤ ☕）、
 * 杂项符号（U+2B00–U+2BFF）、变体选择符（U+FE0F）、麻将/牌（U+1F000–U+1F0FF）。
 */
const EMOJI_RE =
  /[\u{1F000}-\u{1F0FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2190}-\u{21FF}]/u;

/**
 * **口语填充词表**（规矩第 25 条点名的正例）—— 用来判「这一轮是不是已经有口头词了」。
 *
 * ⚠️ 只认规矩里点名的那几个，不自己加 —— 否则「已经带过一个」判不准，
 * 会贴出第二条（一条消息里我们只贴一个）。
 */
export const SPOKEN_WORDS = ['emmm', '嗯…', '哈哈哈', '好耶', '笑死', '绝了', '真的假的'];

/** 默认口径。 */
export const EXPRESS_DEFAULTS = {
  /**
   * ⚠️ **上限已取消**（老板 2026-11-01 第三十四轮拍板：「取消上限，只保留下限和兜底」）。
   *
   * 撤掉的三把尺子：① `maxEmojiPerTurn`（整轮封顶 3 个表情）
   * ② `messagesPerEmoji`（每 3 条气泡一个的间距）③ `maxSpokenPerTurn`（整轮封顶 1 句口语）。
   *
   * ⇒ 现在**只剩两道闸门**：**下限**（窗口密度）+ **兜底**（连续空窗）。
   * **带多少由她自己写**（模型自主 + 〔表情〕〔口语〕标记），
   * 机制层只在「这一轮她一条都没带」时兜底补**一个**（贴最后一条）。
   */
  /**
   * 最多连续几轮整轮没有表情（到这条就补）。
   *
   * ⚠️ **第二十八轮新增**：窗口密度只看「最近 10 轮里有几轮带过」，
   *   一旦达标就能**连着很多轮**都不带 ⇒ 老板看到的正是这个。
   *   这条闸门管的是**连续空窗**，与窗口密度互补（两道闸门取「或」）。
   */
  maxGapWithoutEmoji: 3,
  /**
   * 最多连续几轮整轮没有口语（到这条就补）。
   *
   * ⚠️ 口径比表情紧一档：**2** ＝「最多连着 1 轮整轮没口语」。
   *   口语比表情黏（规矩第 25 条「偶尔…别每条都带」），
   *   但一轮 4~6 条气泡 ⇒ 口语落在消息上约 1/5~1/10 ⇒「别每条都带」仍守住。
   */
  maxGapWithoutSpoken: 2,
  /** 密度窗口：最近多少轮算一轮。 */
  windowTurns: 10,
  /**
   * 表情的**目标密度**（窗口里至少要有几条带过，达不到就补一个）。
   *
   * ⚠️ **为什么是 5 不是 1**：规矩第 10 条写的是
   * 「**大部分**回复里带一个表情符号 …… 但十条里至少有一条要带」。
   * 后半句是**地板**，前半句才是**目标** ⇒ 10 条里 5 条 = 「大部分」。
   * ⚠️ **这里曾经写成 `minPerWindow: 1`，而判定又量的是「窗口里有几轮」**
   * ⇒ 第一轮之后条件恒假 ⇒ **兜底永远不触发**（真机实测：41 条回复 0 次兜底）。
   */
  targetEmojiPerWindow: 5,
  /**
   * 口语的目标密度（规矩第 25 条：不是每条都带，但十条里至少有一条要带）。
   *
   * ⚠️ **第二十七轮**：口语**不再要求有情绪** ——
   *   规矩第 23 条管的是「表情符号和颜文字」，**没管口语**；
   *   第 25 条对口语只要求「十条里至少有一条要带」
   *   ⇒「口语必须有情绪才补」是上一轮**自加的限制** ⇒ 去掉。
   *   没情绪时挑**中性口语池**（嗯… / emmm），场景过滤照旧。
   */
  targetSpokenPerWindow: 1,
  /** 场景：'work' | 'chat'。 */
  scene: 'chat',
};

/**
 * 判断这一轮是**工作场景**还是**闲聊场景**。
 *
 * ⚠️ **判据来自用户这一条的话**（不是她自己的话）——
 * 她在闲聊时也会说「我去把代码翻出来看一眼」，那是她**主动去干活**，
 * 但用户没说工作的事 ⇒ 不该按工作场景处理。
 *
 * @param {string} userText 老板这一轮说的话
 * @returns {'work' | 'chat'}
 */
export function detectScene(userText) {
  const text = String(userText ?? '');
  if (!text) return 'chat';
  for (const w of WORK_SIGNALS) {
    if (text.includes(w)) return 'work';
  }
  return 'chat';
}

/**
 * **第一步 · 分析**：扫正文里的情绪信号。
 *
 * ⚠️ **只扫她自己说的话**（`parts` 拼起来）——
 * 老板的话里出现「开心」不算她的情绪。
 *
 * @param {string} text 她这一轮的正文
 * @returns {{tag: string|null, strength: number, scores: Record<string, number>}}
 */
export function analyzeEmotion(text) {
  const scores = {};
  for (const [tag, words] of Object.entries(EMOTION_SIGNALS)) {
    let n = 0;
    for (const w of words) {
      if (text.includes(w)) n += 1;
    }
    if (n > 0) scores[tag] = n;
  }
  let tag = null;
  let best = 0;
  for (const [k, v] of Object.entries(scores)) {
    if (v > best) {
      best = v;
      tag = k;
    }
  }
  return { tag, strength: best, scores };
}

/**
 * **第二步 · 过滤**：剔掉这个场景不该用的候选。
 *
 * ⚠️ **工作场景剔掉粘人的候选**（`emmm` / `哈哈哈` / `真的假的`）——
 * 「汇报干活」的时候来一句「哈哈哈」很假。
 *
 * ⚠️ **过滤完空了 ⇒ 回退中性池** —— 不能返回空数组：
 * 上层拿不到候选就会把标记原样留在正文里（事故）。
 *
 * @param {{tag: string|null, scene: string, spoken?: boolean}} input
 * @returns {string[]} 候选池（**保证非空**）
 */
export function filterCandidates({ tag, scene, spoken = false }) {
  const neutral = spoken ? NEUTRAL_SPOKEN : NEUTRAL_EMOJI;
  let pool = [];
  if (tag) {
    pool = spoken ? (SPOKEN_POOL[tag] ?? []) : (EMOJI_POOL[tag] ?? []);
    if (scene === 'work' && spoken) {
      // 工作场景：只留最轻的两个（emmm / 嗯…），粘人的全剔。
      pool = pool.filter((w) => w === 'emmm' || w === '嗯…');
    }
    if (scene === 'work' && !spoken) {
      // 工作场景：汇报干活时**不蹦嬉皮笑脸** ——
      // 开心 / 得意那两类表情换成平静的。
      if (tag === 'happy' || tag === 'proud') pool = EMOJI_POOL.calm.slice();
    }
  }
  return pool.length ? pool.slice() : neutral.slice();
}

/**
 * **第三步 · 选择**：从候选里挑一个。
 *
 * ⚠️ **带轮换** —— 同一条候选不连着挑两次（不然每次都是同一个，
 * 那就是贴纸）。用 `used`（最近用过的候选）避开。
 *
 * @param {string[]} candidates
 * @param {{used?: string[]}} [options]
 * @returns {string|null}
 */
export function selectCandidate(candidates, options = {}) {
  const used = Array.isArray(options.used) ? options.used : [];
  if (!candidates.length) return null;
  const fresh = candidates.filter((c) => !used.includes(c));
  const pool = fresh.length ? fresh : candidates;
  return pool[0] ?? null;
}

/**
 * **第四步 · 替换**：把正文里的标记换成选中的那个。
 *
 * ⚠️ **只替换最后一个** —— 规矩第 28 条说的是「最后一句末尾」，
 * 前面出现的同款标记保留原样（那多半是模型写岔了）。
 * ⚠️ 残留的标记由 `applyExpress` 的**收尾**再扫一遍清掉。
 *
 * ⚠️ **贴之前去掉紧邻的句末标点**（`。！？`）——
 * 中文里「请多指教呀。🐟」是别扭的，「请多指教呀🐟」才对。
 *
 * @param {string} text
 * @param {string} marker
 * @param {string} value
 * @returns {{text: string, replaced: boolean}}
 */
export function replaceMarker(text, marker, value) {
  const src = String(text ?? '');
  const idx = src.lastIndexOf(marker);
  if (idx < 0) return { text: src, replaced: false };
  const before = src.slice(0, idx).replace(/[。！？!?…]+$/u, '');
  const after = src.slice(idx + marker.length);
  return { text: before + value + after, replaced: true };
}

/**
 * 正文里有没有标记。
 * @param {string} text
 * @returns {{emoji: boolean, spoken: boolean}}
 */
export function findMarkers(text) {
  const src = String(text ?? '');
  return {
    emoji: src.includes(MARKER_EMOJI),
    spoken: src.includes(MARKER_SPOKEN),
  };
}

/**
 * 把正文里**所有**残留标记清掉（硬约束：标记不许漏到用户面前）。
 *
 * @param {{id: string, text: string}[]} list
 * @param {string} value 用什么清
 * @returns {number} 清掉几个
 */
export function scrubMarkers(list, value) {
  let n = 0;
  for (const part of list) {
    let text = part.text;
    for (const marker of [MARKER_EMOJI, MARKER_SPOKEN]) {
      while (text.includes(marker)) {
        text = replaceMarker(text, marker, value).text;
        n += 1;
      }
    }
    part.text = text;
  }
  return n;
}

/**
 * 正文里有没有表情符号。
 *
 * ⚠️ **为什么要自己判**：服务端得知道「她自己是不是已经带了一个」——
 * 已经带了就不能再补（一条消息一个表情，规矩第 10 条）。
 *
 * @param {string} text
 * @returns {boolean}
 */
export function containsEmoji(text) {
  return EMOJI_RE.test(String(text ?? ''));
}

/**
 * 正文里有没有口语填充词（规矩第 25 条点名的那些）。
 *
 * @param {string} text
 * @returns {boolean}
 */
export function containsSpoken(text) {
  const src = String(text ?? '');
  return SPOKEN_WORDS.some((w) => src.includes(w));
}

/**
 * 窗口**末尾**连续多少轮没带过。
 *
 * ⚠️ **为什么要有它**：窗口密度只看「窗口里有几轮带过」，
 *   达标之后可以连着很多轮都不带 ⇒ 老板看到的「连着两轮什么都没有」就是这么来的。
 *   这条量的是**连续空窗**，与窗口密度互补。
 *
 * ⚠️ **纯函数**（不读时钟、不读全局）⇒ 判据能被负向注入抓。
 *
 * @param {{emoji?: boolean, spoken?: boolean}[]} history 窗口内的历史
 * @param {'emoji'|'spoken'} key 看哪个维度
 * @returns {number} 末尾连续没带过的轮数
 */
export function countTrailingGap(history, key) {
  const list = Array.isArray(history) ? history : [];
  let gap = 0;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const d = list[i];
    const has = Boolean(d && (d[key] ?? d['has' + key.charAt(0).toUpperCase() + key.slice(1)]));
    if (has) break;
    gap += 1;
  }
  return gap;
}

/**
 * 这一轮的兜底表情贴在**哪一条**消息上。
 *
 * ⚠️ **口径**（第三十四轮 · 老板拍板「取消上限，只保留下限和兜底」）：
 *   上限撤掉 ⇒ 兜底预算恒为 **1** ⇒ 位置恒为**最后一条**
 *   （旧口径「最后一条 + 等间隔分散」是**封顶 3 个**时才有的）。
 *
 * ⚠️ **纯函数** ⇒ 判据能被负向注入抓。
 *
 * @param {number} length 这一轮切了几条消息
 * @returns {number} 要贴的消息下标；没有消息时 -1
 */
export function pickEmojiSlot(length) {
  const n = Math.max(0, Math.floor(Number(length) || 0));
  if (!n) return -1;
  return n - 1;
}

/**
 * 把表情**贴到正文末尾**（兜底路径用 —— 没有标记可替换）。
 *
 * ⚠️ **贴之前去掉紧邻的句末标点** —— 中文里「跑完了。🐟」是别扭的，
 * 「跑完了🐟」才对（跟 `replaceMarker` 同一个口径）。
 * ⚠️ **已经带过就不贴**（一条消息里我们只贴一个）。
 *
 * @param {string} text
 * @param {string} value
 * @returns {string}
 */
export function appendEmoji(text, value) {
  const src = String(text ?? '');
  if (!src || !value) return src;
  if (containsEmoji(src)) return src;
  const trimmed = src.replace(/[。！？!?…\s]+$/u, '');
  return trimmed + value;
}

/**
 * 把口语**贴到正文末尾**（兜底路径用）。
 *
 * ⚠️ 口径跟 `appendEmoji` 一样：**已经带过就不贴**
 * （一条消息里我们只贴一个装饰）。
 *
 * @param {string} text
 * @param {string} value
 * @returns {string}
 */
export function appendSpoken(text, value) {
  const src = String(text ?? '');
  if (!src || !value) return src;
  if (containsSpoken(src)) return src;
  const trimmed = src.replace(/[。！？!?…\s]+$/u, '');
  return trimmed + value;
}

/**
 * **主入口**：给这一轮定表达。
 *
 * ⚠️ **所有随时间变化的东西都从 `input` 注入**（`history` / `used`），
 * 本函数不读时钟、不读全局状态 —— 所以判据可以被负向注入抓。
 *
 * @param {{id: string, text: string}[]} parts 这一轮切好的短消息
 * @param {{
 *   scene?: string,
 *   history?: string[],      // 最近若干轮带过的表情（用来算密度）
 *   used?: string[],         // 最近用过的候选（用来轮换）
 *   options?: Partial<typeof EXPRESS_DEFAULTS>,
 * }} [input]
 * @returns {{parts: {id: string, text: string}[], decision: object}}
 */
export function applyExpress(parts, input = {}) {
  const cfg = { ...EXPRESS_DEFAULTS, ...(input.options ?? {}) };
  const scene = String(input.scene ?? cfg.scene);
  const history = Array.isArray(input.history) ? input.history : [];
  const used = Array.isArray(input.used) ? input.used : [];
  const list = Array.isArray(parts) ? parts.map((p) => ({ id: p.id, text: String(p.text ?? '') })) : [];

  const joined = list.map((p) => p.text).join('\n');
  const emotion = analyzeEmotion(joined);
  const marked = findMarkers(joined);

  /** @type {Record<string, any>} */
  const decision = {
    scene,
    emotion: emotion.tag,
    strength: emotion.strength,
    emoji: null,
    spoken: null,
    source: 'none',
    markerEmoji: marked.emoji,
    markerSpoken: marked.spoken,
    scrubbed: 0,
    /**
     * 这一轮用掉的表情。
     * ⚠️ **第三十四轮起兜底只贴一个** ⇒ 数组长度 0 或 1；标记路径也只贴一个。
     * ⚠️ `decision.emoji` 仍然是**单值**（第一个）—— 有自检断言依赖它是单值。
     */
    emojiAll: [],
  };

  // ── 密度闸门：窗口里**带过表情**的轮数（不是窗口的轮数）──
  // ⚠️ **这里曾经量的是「窗口里有几轮」** ⇒ 第一轮之后条件恒假
  //   ⇒ 兜底**永远不触发**。量的是「有几轮带过」，这才是密度。
  const window = history.slice(-cfg.windowTurns);
  const emojiTurns = window.filter((d) => d && (d.emoji || d.hasEmoji)).length;
  const spokenTurns = window.filter((d) => d && (d.spoken || d.hasSpoken)).length;
  // ⚠️ **第二十八轮**：加「连续空窗」这道闸门。
  //   窗口密度达标之后能连着很多轮都不带 ⇒ 老板看到的「连着两轮什么都没有」。
  //   两道闸门取「或」：密度没到 ⇒ 补；密度到了但空窗太长 ⇒ 也补。
  const emojiGap = countTrailingGap(window, 'emoji');
  const spokenGap = countTrailingGap(window, 'spoken');
  const needEmoji =
    emojiTurns < cfg.targetEmojiPerWindow || emojiGap + 1 >= cfg.maxGapWithoutEmoji;
  const needSpoken =
    spokenTurns < cfg.targetSpokenPerWindow || spokenGap + 1 >= cfg.maxGapWithoutSpoken;

  // ── 表情 ──
  let emojiValue = null;
  let emojiSource = 'none';
  // ⚠️ **这一轮她自己带没带**（第三十四轮：兜底口径改成「整轮一条都没带才补」）。
  const turnHasEmoji = list.some((p) => containsEmoji(p.text));
  // ⚠️ **我们把表情贴在了哪一条**（口语兜底不许跟它叠在同一条上）。
  let emojiTargetIdx = -1;
  if (marked.emoji) {
    // 模型自己标了 ⇒ 一定给它挑一个（**标记优先于密度闸门**）
    emojiValue = selectCandidate(filterCandidates({ tag: emotion.tag, scene }), { used });
    if (emojiValue) emojiSource = 'marker';
  } else if (needEmoji && !turnHasEmoji) {
    // 兜底：**这一轮她一条都没带** ⇒ 补**一个**，贴**最后一条**。
    //
    // ⚠️ **没有情绪也要能补**：规矩第 23 条明确说
    // 「没有情绪冒出来时**也可以带一个**，别硬演」+
    // 「讲事实、答问题、汇报干活的时候**可以带一个**」
    // ⇒ 识别不出情绪时挑**中性池**，不是「不补」。
    //
    // ⚠️ **第三十四轮（老板拍板「取消上限，只保留下限和兜底」）**：
    //   整轮封顶 + 等间隔间距**全撤** ⇒ 预算恒为 1 ⇒ 位置恒为最后一条。
    //   「已经带过就不贴」⇒ 这一轮任何一条带了表情，这一轮就**不补**。
    const idx = pickEmojiSlot(list.length);
    const part = idx >= 0 ? list[idx] : null;
    if (part && !containsEmoji(part.text)) {
      const pool = filterCandidates({ tag: emotion.tag, scene });
      const value = selectCandidate(pool, { used: [...used, ...decision.emojiAll] });
      if (value) {
        part.text = appendEmoji(part.text, value);
        decision.emojiAll.push(value);
        emojiTargetIdx = idx;
      }
    }
    if (decision.emojiAll.length) {
      emojiValue = decision.emojiAll[0];
      emojiSource = 'fallback';
    }
  }
  if (emojiSource === 'marker' && emojiValue) {
    // ⚠️ **带标记的路径**：模型自己写了 `〔表情〕` ⇒ 替掉它。
    //   ⚠️ **第二十八轮把两条路彻底分开** —— 原来兜底路径也走这一段，
    //   而兜底**没有标记可替换** ⇒ `replaced` 恒 false ⇒ 正文一个字没变。
    //   现在兜底在上一段**已经贴进正文**，这里只处理 marker。
    for (let i = 0; i < list.length; i += 1) {
      const r = replaceMarker(list[i].text, MARKER_EMOJI, emojiValue);
      if (r.replaced) {
        list[i].text = r.text;
        emojiTargetIdx = i;
        break;
      }
    }
    decision.emoji = emojiValue;
    decision.emojiAll = [emojiValue];
    decision.source = 'marker';
  } else if (decision.emojiAll.length) {
    // 兜底路径：**已经贴进正文了**（分散在几条上）⇒ 这里只汇总。
    decision.emoji = decision.emojiAll[0];
    decision.source = 'fallback';
  }
  // 这一轮**最终**有没有表情（含她自己写的那个）—— 密度按这个算。
  decision.hasEmoji = containsEmoji(list.map((p) => p.text).join('\n'));

  // ── 口语 ──
  // ⚠️ **这一轮她自己带没带口语**（第三十四轮：兜底口径改成「整轮一条都没带才补」）。
  const turnHasSpoken = list.some((p) => containsSpoken(p.text));
  // ⚠️ **第二十七轮**：口语**不再要求有情绪**（老板 2026-10-31 拍板）。
  //   理由：规矩第 23 条管的是「表情符号和颜文字」，**没管口语**；
  //   第 25 条对口语只要求「十条里至少有一条要带」
  //   ⇒「口语必须有情绪才补」是上一轮**自加的限制**，规矩里没有 ⇒ 去掉。
  //   没情绪时挑中性口语池（嗯… / emmm）；工作场景仍只用这两个。
  if (marked.spoken) {
    const spokenValue = selectCandidate(filterCandidates({ tag: emotion.tag, scene, spoken: true }), { used });
    if (spokenValue) {
      for (const part of list) {
        const r = replaceMarker(part.text, MARKER_SPOKEN, spokenValue);
        if (r.replaced) {
          part.text = r.text;
          break;
        }
      }
      decision.spoken = spokenValue;
    }
  } else if (needSpoken && !turnHasSpoken) {
    // ⚠️ **第二十八轮**：口语候选池并入中性池做轮换 ——
    //   `SPOKEN_POOL.calm` 只有「嗯…」一个 ⇒ 之前每轮都挑它同一个（贴纸感）。
    //   并进中性池 ⇒ 「嗯…」/「emmm」能轮换。
    const pool = filterCandidates({ tag: emotion.tag, scene, spoken: true });
    const rot = [...pool, ...NEUTRAL_SPOKEN.filter((w) => !pool.includes(w))];
    const spokenValue = selectCandidate(rot, { used });
    if (spokenValue) {
      // ⚠️ 贴到**最后一条还没带口语**的消息上 ——
      //   原来只贴最后一条，那条若已经带了口语就整轮没有（闸门等于白设）。
      let placed = false;
      // ⚠️ **同一条不叠两个我们贴的装饰**（表情 + 语气词）——
      //   但**这一轮只剩这一条能贴**时宁可叠上，也要把口语下限保住。
      const canElsewhere = list.some((_, i) => i !== emojiTargetIdx && !containsSpoken(list[i].text));
      for (let i = list.length - 1; i >= 0; i -= 1) {
        if (containsSpoken(list[i].text)) continue;
        if (i === emojiTargetIdx && canElsewhere) continue;
        list[i].text = appendSpoken(list[i].text, spokenValue);
        placed = true;
        break;
      }
      if (placed) decision.spoken = spokenValue;
    }
  }
  decision.hasSpoken = containsSpoken(list.map((p) => p.text).join('\n'));

  // ── 收尾硬约束：**标记绝不许漏到用户面前** ──
  const leftover = list.some((p) => p.text.includes(MARKER_EMOJI) || p.text.includes(MARKER_SPOKEN));
  if (leftover) {
    const fallback = decision.emoji || decision.spoken || NEUTRAL_EMOJI[0];
    decision.scrubbed = scrubMarkers(list, fallback);
  }

  return { parts: list, decision };
}

/**
 * 把这一轮的决策记进历史（供下一轮算密度用）。
 *
 * ⚠️ **记的是「这一轮最终有没有带」**（含她自己写的那个）——
 * 密度要按实际效果算，不是按「服务端挑了几个」算。
 *
 * @param {string[]} history 现有历史
 * @param {object} decision
 * @returns {string[]}
 */
export function pushHistory(history, decision) {
  const list = Array.isArray(history) ? history.slice() : [];
  list.push({
    emoji: Boolean(decision && (decision.hasEmoji ?? decision.emoji)),
    spoken: Boolean(decision && (decision.hasSpoken ?? decision.spoken)),
  });
  return list.slice(-40);
}

/**
 * 给浮窗气泡用的单行版本（闲话走这条）—— 闲话只有一条，
 * 标记就在这一条里。
 *
 * @param {string} text
 * @param {{scene?: string, used?: string[], history?: string[]}} [input]
 * @returns {{text: string, decision: object}}
 */
export function applyExpressToLine(text, input = {}) {
  const parts = [{ id: 'line', text: String(text ?? '') }];
  const out = applyExpress(parts, input);
  return { text: clip(out.parts[0]?.text ?? '', 300), decision: out.decision };
}
