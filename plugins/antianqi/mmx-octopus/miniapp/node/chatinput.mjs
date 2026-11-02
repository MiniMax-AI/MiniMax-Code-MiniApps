// @ts-check

/**
 * 每轮送进她耳朵的那段文本的**唯一拼装实现**。
 *
 * 为什么单独成文件（而不是继续塞在 `server.mjs` 的闭包里）：
 * 「她这一轮到底听到了什么」是一条判断，塞在闭包里就只能**读源码猜**（结构断言），
 * 挪出来就能**直接调、逐条对比**（行为断言）。
 * 同一个项目里 `clip.mjs` / `replyflow.mjs` / `summarize.mjs` / `atomic-json.mjs`
 * 都是这个路数 —— 判断归一个文件，别的文件不再另写一份。
 *
 * ⭐ **注入的时机**（老板 2026-10-29 口径）：
 * 身份头（`[你是谁]` + 底稿 + 规矩）**只在会话的第一轮拼一次**，
 * 后面每一轮不再重贴。
 *
 * 为什么这样就够：拼进去的那段是作为 `user` 角色的消息发出去的，
 * **它会留在会话历史里**，后面每一轮她都看得见 —— 不需要每条都重新说一遍。
 * 这正是 OpenClaw 那种做法（身份层靠 harness/指令层活着，不靠反复重贴）。
 *
 * 之前是**每轮都重贴**（规矩正文 1148 tokens + 底稿 200 ≈ 1350 tokens/轮），
 * 既拖慢每轮，又把会话历史撑爆（实测第 2 轮上下文就 3 万+ tokens）。
 */

// ⚠️ **第三十七轮**：心情 / 亲近程度的措辞在 state.mjs（heartWord / intimacyWord）——
//   **同一个真源**，这里不另写一份（跟语气档 buildToneHint 的规矩一样）。
import { heartWord, intimacyWord } from './state.mjs';

/** 用户原话那一段的抬头。 */
export const USER_MESSAGE_HEAD = '[用户消息]';

/**
 * 身份头的抬头（她在会话开头被告知「你是谁」的地方）。
 */
export const IDENTITY_HEAD = '[你是谁]';

/**
 * 用户这一条短到多少字，就算「他很忙 / 懒得多说」。
 *
 * ⚠️ **为什么要有这个**（老板 2026-10-30 第十九轮）：
 * 规矩第 27 条要求她「按用户这一条的长短调节话量」——
 * 但**光有规矩没用**，她得**看得见那个长度**才知道该不该少说。
 * 所以这里每轮多带一句极短的说明（只在用户这一条很短时才加，长消息一个字都不多花）。
 *
 * 口径跟着规矩第 27 条的措辞走：**「用户这一条只有 N 个字」**。
 */
export const SHORT_USER_MAX = 6;

/** 用户这一条很短时用的抬头。 */
export const SHORT_USER_HEAD = '[用户这一条很短]';

/**
 * 用户这一条只有几个字时，补一句给她；不短就返回空串。
 *
 * @param {string} text 用户这一条的原话
 * @param {number} [max] 短到多少字算短
 * @returns {string} 要插进这一轮输入的说明（空串 = 不用加）
 */

export function briefUserNote(text, max = SHORT_USER_MAX) {
  const n = Array.from(String(text ?? '')).length;
  if (!n || n > max) return '';
  // ⚠️ **第三十七轮补的半句**：规矩第 27 条要她「少说两句」，但她得知道**该少说**。
  //   原来只报长度 —— 她看得见长度，却不知道要拿它做什么。
  return (
    SHORT_USER_HEAD + ' 用户这一条只有 ' + n + ' 个字' +
    ' —— 他这会儿话很少，你也少说一句，一条短的就行。'
  );
}


/**
 * 心情提示块的抬头（第三十七轮）。
 */
export const HEART_HINT_HEAD = '[你现在的心情]';

/**
 * 心情提示块（契约 §6.1 的「用户明确问起时她口头说明」—— 第三十七轮补上）。
 *
 * ⚠️ **只在用户明确问起时才拼** —— 平时一个字节都不花（心情不显示、不进 UI）。
 * ⚠️ **她不报数字** —— 「不说出具体数字」是不露程序痕迹的口径。
 * ⚠️ **判据来自用户原话**（chatter.mjs 的 heartAskTopics）——
 *   **不读模型输出文本**（契约 §6.1 判据纪律）。
 *
 * @param {{heart?: number, intimacy?: number, topics?: {heart?: boolean, intimacy?: boolean}} | null} heart
 * @returns {string} 空串 = 不用加
 */
export function buildHeartHint(heart) {
  if (!heart) return '';
  const topics = heart.topics || {};
  if (!topics.heart && !topics.intimacy) return '';
  const lines = [];
  if (topics.heart) lines.push('你现在的心情：' + heartWord(heart.heart) + '。');
  if (topics.intimacy) lines.push('你们现在的亲近程度：' + intimacyWord(heart.intimacy) + '。');
  if (!lines.length) return '';
  return (
    HEART_HINT_HEAD +
    '\n' +
    lines.join('\n') +
    '\n' +
    '这是你自己的感觉，照实说就行；别报数字，也别说什么「档位」「参数」「亲密度值」。'
  );
}

/**
 * 拼一轮的输入。
 *
 * 段落顺序（不要随手改）：
 *  1. 状态摘要 —— 她得知道 MCode 现在在干什么
 *  2. 称呼 —— **每轮都带**（名字和称呼用户随时能改，静态化就不生效了）
 *  3. 身份层（底稿 + 样子 + 规矩）—— **只在降级时带**；
 *     正常情况下它已经写进 agent 目录的 `AGENTS.md`，宿主每轮读它（压缩压不掉）
 *  4. 接续摘要 —— 换会话时让她接上上一段（见 `buildCarryOver`）
 *  5. **日记记忆** —— 她的日记（见 `memory.mjs` 的 `pickDiaryMemory`）
 *  5b. **背景故事** —— 她的来历（见 `storyscope.mjs` 的 `shouldLoadStory`；**问到才给**）
 *  6. 用户原话
 *
 * ⚠️ **第 5 段是 2026-10-29 新加的**（老板：「日记是很重要的记录，
 * 就相当于每天整理的 memory 或者重点」）。日记不进聊天区、不进 `AGENTS.md` ——
 * 它每轮都在变，`AGENTS.md` 那种静态落点装不下它。
 * 选这个位置是因为它是**最后一段背景**，紧接着就是用户原话 —— 最后读到的最容易用。
 *
 * ⚠️ **「身份层要不要带」这个开关不外传** ——
 * 它由 `identityInFile`（身份层是不是已经在文件里）**在函数内部**决定。
 * 外传就等于把「每轮都重贴」这个开关交到调用方手上，
 * 迟早有人传 true，而那时候自检是抓不到的（负向注入实测过这个洞）。
 *
 * @param {{
 *   text: string,
 *   summary?: string | null,
 *   naming?: string,
 *   baseline?: string,
 *   appearance?: string,
 *   rules?: string,
 *   identityInFile?: boolean,
 *   carryOver?: string | null,
 *   memory?: string | null,
 *   storyScope?: string | null,
 *   tone?: {{tone: string, mood?: string} | null} 语气档（契约 §6.1）
 *   heart?: {heart: number, intimacy: number, topics: {heart: boolean, intimacy: boolean}} | null
 *         心情 / 亲近程度（第三十七轮）—— **只在用户明确问起时**才传
 * }} input
 * @returns {string}
 */
/**
 * 语气档提示块（契约 §6.1）。
 *
 * ⚠️ **只影响措辞，不改事实** —— 块里必须写死这条约束，否则语气一软
 *   「不确定」就会被说成「确定」（规矩：不确定就说不确定）。
 * ⚠️ **不写进 rules.md**：规矩正文只能追加，而语气每轮都可能变 —— 只能进输入。
 * ⚠️ **不许她说出来** —— 她一提「语气」「档」，程序痕迹就露了。
 *
 * @param {{tone?: string, mood?: string} | null} toneInfo
 * @returns {string} 空串 = 没有语气档
 */
export function buildToneHint(toneInfo) {
  const tone = String(toneInfo?.tone ?? '').trim();
  if (!tone) return '';
  const base = {
    distant: '短句为主，少用语气词，别主动示好',
    familiar: '自然平铺，偶尔可以主动一点',
    close: '可以带一个语气词，可以主动表达情绪',
  }[tone];
  if (!base) return '';
  const mood = {
    bright: '；这会儿轻快，句子可以稍长一点',
    quiet: '；这会儿安静，句子短一点、少主动',
  }[String(toneInfo?.mood ?? '')] || '';
  return (
    '[语气]\n' +
    '这会儿你对用户说话的语气：' +
    base +
    mood +
    '。\n' +
    '只影响**怎么说**，不影响**说的对不对** —— 「查到了」还是「查不到」照实说；' +
    '不确定就说不确定，别因为语气软就把不确定说得像确定。\n' +
    '不要把「语气」「档」这些词说出来，也不要解释你为什么这么说。'
  );
}

export function assembleChatInput({
  text,
  summary = null,
  naming = '',
  baseline = '',
  appearance = '',
  rules = '',
  identityInFile = false,
  carryOver = null,
  memory = null,
  storyScope = null,
  styleMem = null,
  tone = null,
  heart = null,
}) {
  const blocks = [];
  if (summary) blocks.push(String(summary));
  if (naming) blocks.push(String(naming));
  if (!identityInFile) {
    // 降级：身份层没进文件，只能每轮拼在 user 消息里。
    // 三样都要带：底稿（她是谁）、样子（她长什么样）、规矩（她怎么做事）。
    const fallback = [baseline, appearance, rules].filter(Boolean).join('\n\n');
    if (fallback) blocks.push(fallback);
  }
  if (carryOver) blocks.push(String(carryOver));
  if (memory) blocks.push(String(memory));
  // ⭐ **背景故事**（老板 2026-10-30 第二十二轮）：她自己的来历。
  // 放在日记后面 —— 两块都是「她自己记得的东西」，挨着用户原话之前最后读到。
  if (storyScope) blocks.push(String(storyScope));
  // ⭐ **她从老板身上学到的说话习惯**（第二十六轮第三档第二项）：
  // 放在日记与背景之后 —— 三块都是「她自己知道的东西」。
  if (styleMem) blocks.push(String(styleMem));
  // ⭐ **语气档**（契约 §6.1）：只影响措辞，不改事实。
  // 放在「她自己知道的东西」之后、用户原话之前 —— 她最后读到的最容易用。
  const toneHint = buildToneHint(tone);
  if (toneHint) blocks.push(toneHint);
  // ⭐ **她被问起心情 / 亲近程度时**（第三十七轮）：才把这两个值告诉她自己。
  //   平时**不塞** —— 心情不显示（契约 §6.1），只有「用户明确问起」才口头说明。
  const heartHint = buildHeartHint(heart);
  if (heartHint) blocks.push(heartHint);
  // ⚠️ **位置要紧**：紧挨着用户原话之前 —— 最后读到的最容易用。
  //    规矩第 27 条要她「按用户这一条的长短调节话量」，她得先看见这个长度。
  const brief = briefUserNote(text);
  if (brief) blocks.push(brief);
  blocks.push(`${USER_MESSAGE_HEAD}\n${text}`);
  return blocks.join('\n\n');
}

/**
 * 换会话时的「上一段聊到这」。
 *
 * 什么时候用：她的专属会话被换掉的时候（改名 / 称呼变了 / 轮数到顶 / 上一轮卡死）。
 * 新会话是空的 —— 不带这一段，她一上来就失忆，用户会觉得「刚才不是聊得好好的吗」。
 *
 * 为什么用「原话摘录」而不是「模型总结」：
 *  - 不花一次模型调用，也就没有「总结歪了」的风险；
 *  - 原话最不容易失真。
 *
 * @param {readonly {role: string, text: string}[]} messages 聊天历史（新的在后）
 * @param {{herName?: string, limit?: number, maxChars?: number}} [options]
 * @returns {string} 空串 = 没有可接续的内容
 */
export function buildCarryOver(messages, options = {}) {
  const { herName = 'MMX', limit = 8, maxChars = 60 } = options;
  const list = Array.isArray(messages) ? messages : [];
  const recent = list
    .filter((item) => item && (item.role === 'user' || item.role === 'her'))
    .slice(-Math.max(0, limit));
  if (!recent.length) return '';
  const lines = recent.map((item) => {
    /**
     * ⭐ **用户那几句必须带时态标记**（2026-10-30 第二十三轮）：
     * 原样抄成「· 用户：帮我把昨天那批订货数据上传一下，另外新开一个火锅品类表格」的话，
     * 它跟「[用户消息]」里**现在的**命令长得一模一样 ——
     * 她读到的是一条待办的活，于是闷头去干
     * （实测：她照这条旧话去查了抖音达人广场，还照老板自己的表格式
     *   往桌面的《齐大达人.xlsx》里新建了一个 sheet）。
     * 加上「刚才」两个字，它才读得出那是**过去说过的话**。
     */
    const who = item.role === 'user' ? '用户（刚才）' : herName;
    const text = String(item.text ?? '').replace(/\s+/g, ' ').trim();
    return `· ${who}：${clipLine(text, maxChars)}`;
  });
  return (
    '[上一段聊到这]\n' +
    '（背景，不用重复回答；**这是刚才聊过的，已经过去了 —— 不是老板现在要你做的事**。' +
    '只有最后那段「用户消息」才是现在的活）\n' +
    lines.join('\n')
  );
}

/**
 * 一行最多留几个字（超了加省略号）。
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function clipLine(text, max) {
  const points = Array.from(text);
  if (points.length <= max) return text;
  return `${points.slice(0, Math.max(1, max - 1)).join('')}…`;
}
