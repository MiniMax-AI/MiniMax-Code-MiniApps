// @ts-check

/**
 * 背景故事参考范围 —— 老板 2026-10-30 第二十二轮：
 * 「她的背景故事，和后面的记忆，自己写的日记，都可以加入参考的范围啊」
 *
 * ⭐ **为什么有这一层**（实测数据见 `REFERENCE §12.12`）：
 * 她 79 条真实回复的素材出处是 —— **会话旧事 42 条 / 底稿 29 条 / 日记 5 条 / 自创 8 条**。
 * 三样里**只有背景故事从来没进过**：底稿文件里明明写着「完整故事留着，**被问起时才需要**」，
 * 但那个机制**从来没实现** —— 她 961 汉字的来历（弄堂、石库门、阿婆、作文、星野水手、画的小章鱼…）
 * 运行时一句都进不去。
 *
 * ⭐ **什么时候注入**（本模块唯一的判断，只此一处）：
 * 老板这一条**问到她的过去 / 来历**时注入；否则不注入。
 * - 平时**零成本**（不涨上下文、不稀释规矩正文的注意力）；
 * - 被问起往事时，她手上就有**完整的身世**可以讲，而不是现编。
 *
 * ⚠️ **为什么不做成"每轮常驻"**：底稿文件自己写了「每轮全带会让 prompt 涨 ~50%，
 * 会稀释规矩正文的注意力」。故事正文 959 汉字（≈640 tokens），常驻不划算；
 * 而「被问起时才需要」**本来就是那份文件写好的设计意图** —— 本模块是把它实现出来。
 *
 * **单一真源**：故事正文在 `mmx-character/persona/story-mmx-origin.md`，
 * 运行时副本（投影）在 `miniapp/node/identity/STORY.md`（由 `tools/sync_story_scope.py` 生成/校验）。
 * 本模块**只管判断与拼装**，一个字都不改故事本身。
 */

import { contentGrams } from './memory.mjs';
import { textLength } from './clip.mjs';

/** 注入块的抬头。 */
export const STORY_SCOPE_HEAD = '[你的故事]';

/** 注入块里那一句提示（别让她整段背）。 */
export const STORY_SCOPE_NOTE = '（你的来历。老板问起往事时才用；讲的时候用你自己的话，别整段背。）';

/**
 * 问「她的过去 / 来历」的**意图词**。
 *
 * ⚠️ **故意写得长而具体**：短词（"过去""以前""名字"）在老板的工作语境里
 * 也会出现（"把过去那批订单导出来""这个文件名字改一下"）⇒ 会误触发。
 * 宁可漏触发（不注入故事 = 退回旧行为），不可误触发（乱塞 959 字进 prompt）。
 */
export const STORY_INTENT_WORDS = [
  '小时候', '童年', '你还记得', '记不记得', '讲讲你', '说说你自己', '你是谁',
  '你叫什么', '你的名字', '名字是谁', '你的来历', '你的身世', '你的过去',
  '你的故事', '你的小时候', '你的童年', '你长大的地方', '你老家', '你的老家',
  '你爸妈', '你妈', '你爸', '你家里', '你在哪长大', '你是哪里人',
];

/**
 * 故事里的**专属名词** —— 出现这些词，就是在说她的故事。
 * （石库门/阿婆/星野水手/弄堂画室…… 老板提这些 ⇒ 讲来历最合适。）
 */
export const STORY_PROPER_WORDS = [
  '阿婆', '石库门', '木楼梯', '星野', '水手', '画室', '两万字', '小章鱼',
  '静物', '弄堂', '作文', '车轱辘', '憨笃笃', '美术老师',
];

/** 注入正文最多几个字（按码点算；故事正文 959 汉字 ⇒ 今天不会被裁）。 */
export const STORY_MAX_CHARS = 1400;

/**
 * 从投影文件里取出故事正文（「## 正文」之后）。
 *
 * @param {unknown} md 投影文件全文
 * @returns {string} 正文（空串 = 没有故事）
 */
export function parseStoryBody(md) {
  const text = String(md ?? '');
  const i = text.indexOf('## 正文');
  if (i < 0) return '';
  return text.slice(i + '## 正文'.length).trim();
}

/**
 * 按段落裁正文，**不切半句**（故事是叙事，砍在半句上比短一点更糟）。
 *
 * @param {unknown} body
 * @param {number} [maxChars]
 * @returns {string}
 */
export function fitStoryBody(body, maxChars = STORY_MAX_CHARS) {
  const paras = String(body ?? '')
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
  const kept = [];
  let used = 0;
  for (const p of paras) {
    const len = textLength(p);
    if (kept.length && used + len > maxChars) break;
    kept.push(p);
    used += len;
  }
  return kept.join('\n\n');
}

/**
 * 这一条要不要把背景故事放进参考范围？
 *
 * 判据（任一命中即触发）：
 * ① **意图词** —— 老板在问她的过去/来历；
 * ② **专属名词** —— 提到了她故事里的东西；
 * ③ **3-gram 命中** —— 老板这一条里的某个三字片段原样出现在故事正文里
 *    （复用日记记忆层那套切词与停用片段 —— **同一判断只写一处**）。
 *
 * ⚠️ ③ 用的是 `contentGrams`（带停用片段过滤）：像「小时候」这种含停用片段「时候」的
 * 三字词会被滤掉 —— 所以意图词表里必须有「小时候」「童年」兜着。
 *
 * @param {unknown} query 老板这一条
 * @param {unknown} body 故事正文
 * @param {{intentWords?: readonly string[], properWords?: readonly string[]}} [options]
 * @returns {{triggered: boolean, why: string}}
 */
export function shouldLoadStory(query, body, options = {}) {
  const {
    intentWords = STORY_INTENT_WORDS,
    properWords = STORY_PROPER_WORDS,
  } = options;
  const text = String(query ?? '');
  const story = String(body ?? '');
  if (!text.trim()) return { triggered: false, why: 'empty_query' };
  if (!story.trim()) return { triggered: false, why: 'no_story' };

  for (const w of intentWords) {
    if (text.includes(w)) return { triggered: true, why: `intent:${w}` };
  }
  for (const w of properWords) {
    if (text.includes(w)) return { triggered: true, why: `proper:${w}` };
  }

  const q = contentGrams(text, 3);
  if (q.size) {
    const b = contentGrams(story, 3);
    for (const g of q) {
      if (b.has(g)) return { triggered: true, why: `gram:${g}` };
    }
  }
  return { triggered: false, why: 'no_hit' };
}

/**
 * 拼注入块。
 *
 * @param {unknown} body 故事正文
 * @param {{maxChars?: number}} [options]
 * @returns {string} 空串 = 没有可注入的（不塞空段）
 */
export function buildStoryBlock(body, options = {}) {
  const { maxChars = STORY_MAX_CHARS } = options;
  const text = fitStoryBody(body, maxChars);
  if (!text) return '';
  return `${STORY_SCOPE_HEAD}\n${STORY_SCOPE_NOTE}\n${text}`;
}
