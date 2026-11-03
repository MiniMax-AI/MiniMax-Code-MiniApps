/**
 * 把 Agent 的最终回复压成**一句能进气泡的短摘要**。
 *
 * ============================ 为什么有这个东西 ============================
 *
 * 宿主 `observe({all:true})` 的 `message.committed` 事件**带最终回复正文**
 * （`text` 字段），而且宿主保证「never dropped the final reply」。
 * 也就是说：**数据一直送到门口了，只是以前没用** ——
 * 以前只置了个布尔标记（"这一轮有回复"），正文直接扔了。
 *
 * 于是「《标题》这一轮结束了」这句泛泛的播报可以升级成
 * 「这一轮做完了：<结论>」—— 粒度从「会话轮次」变成「语义」。
 *
 * ============================ 为什么是规则式而不是 LLM ============================
 *
 * 1. **零失败模式**：不占 run slot、不会 BUSY、不会超时、不看门狗。
 * 2. **零延迟**：数据已经在事件里，摘要就是纯字符串处理。
 * 3. **气泡本来就放不下长文**：`state.say` 的上限是 300 字，
 *    而桌宠浮窗只有 220px 宽 —— 整段塞进去本来也没意义。
 * 4. Agent 的最终回复**第一句通常就是结论**
 *    （「完成了：xxx」「测试全过：300 个」「还差 2 个没过：a、b」）。
 *
 * 将来想换 LLM 摘要（`session.run` 跑一轮让模型总结），改调用方即可，
 * **规则不许分裂**：那时的真源仍然是本文件里的纯函数。
 */

/**
 * 摘要最大长度（字符）。
 *
 * 40 字是按浮窗气泡宽度定的（220px 窗口，164px 头像旁的窄条）——
 * 40 字大约 3 行，不会把气泡撑成一堵墙。
 */
export const SUMMARY_MAX = 40;

/** 剥完 markdown 后，至少要这么多字符才算「有内容」。 */
const MIN_CONTENT = 2;

/** 句子终止符（中英文）。 */
const SENTENCE_END = /[。！？!?；;]/;

/**
 * 剥掉 markdown 与代码块，只留「人能读的散文」。
 *
 * 为什么必须剥：Agent 的最终回复里经常先甩一段代码块或一张表格
 * （「```bash」「| 项 | 值 |」），直接取首行会取到**代码**，
 * 气泡里显示一行 shell 毫无意义。
 *
 * @param {string} text
 * @returns {string}
 */
export function stripMarkdown(text) {
  let out = String(text ?? '');
  // 围栏代码块（含语言标注）整段去掉。
  // 替换成**换行**而不是空格 —— 留着空格会拼出「 跑完了」这种带残渣的行。
  out = out.replace(/```[\s\S]*?```/g, '\n');
  // 未闭合的围栏（回复被截断时常见）—— 去掉开头到结尾
  out = out.replace(/```[\s\S]*$/, '\n');
  // 行内代码
  out = out.replace(/`[^`]*`/g, '');
  // 表格：整行去掉（分隔行 `|---|` 也在这条里）
  out = out.replace(/^[ \t]*\|.*$/gm, '\n');
  // 图片 ![alt](url) 整个去掉；链接 [text](url) 留 text
  out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  out = out.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  // 标题符 / 引用符 / 列表符号 / 强调
  out = out.replace(/^[ \t]*#{1,6}[ \t]*/gm, '');
  out = out.replace(/^[ \t]*>[ \t]?/gm, '');
  out = out.replace(/^[ \t]*[-*+][ \t]+/gm, '');
  out = out.replace(/^[ \t]*\d+[.)][ \t]+/gm, '');
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1');
  out = out.replace(/__([^_]+)__/g, '$1');
  out = out.replace(/\*([^*]+)\*/g, '$1');
  out = out.replace(/_([^_]+)_/g, '$1');
  // 水平线
  out = out.replace(/^[ \t]*([-*_])[ \t]*(\1[ \t]*){2,}$/gm, '\n');
  return out;
}

/**
 * **铺垫句**开头词（寒暄 / 承接语）。
 *
 * 为什么需要：Agent 的回复**常常以寒暄开头**（「好的，我来处理这个。」）。
 * 原来「取第一句」会把寒暄当摘要 —— **真结论反而被丢了**：
 * 「好的，我来处理这个。」→ 摘要就这句，而真正的「测试 300 个全过」在下一句。
 * 这是实测踩到的（第一版摘要就是这个问题）。
 *
 * ⚠️ **词表要窄**：宁可漏判（把寒暄当结论），不可误判（把正文当寒暄跳掉）。
 * 第一版把「先」「这(就|是)」「来」也算进铺垫 → 「先铺一堆背景说明」被当成
 * 寒暄跳过，摘要反而跳到了后面的句子 —— 实测踩到，已收窄。
 */
const PRELUDE_RE =
  /^(好的?|行吧|当然|收到|明白|了解|知道了|嗯+|哦+|噢|嗨|你好|我来|让我|我先|接下来|下面(是|给|看)|请稍等|马上|别急|思(考|索)一下)/;

/**
 * **结果提示词** —— 句里有这些，更可能是结论。
 *
 * 作用是当「铺垫词」和「结果词」同时出现时，**以结果词为准**
 * （「好的，测试全过了」不是铺垫，是结论）。
 */
const RESULT_RE =
  /(完成|成功|通过|失败|修好|修完|修过|部署|上线|发布|全过|全绿|剩下|还差|共|结果|错误|异常|搞定|好了|完毕|不动|没动|已(经)?(修|部署|上线|完成|通过)|done|pass|fail|error|ok\b|✓|✗)/i;

/**
 * 这句是不是「铺垫」（不含结论的客套 / 承接语）。
 * @param {string} sentence
 * @returns {boolean}
 */
export function isPrelude(sentence) {
  const text = String(sentence ?? '').trim();
  if (!text) return true;
  // 有结果词 → 不是铺垫（哪怕它以「好的」开头）
  if (RESULT_RE.test(text)) return false;
  return PRELUDE_RE.test(text);
}

/**
 * 把一段文本切成句子（按行 + 行内句末标点）。
 * @param {string} paragraph
 * @returns {string[]}
 */
export function splitSentences(paragraph) {
  const out = [];
  for (const line of String(paragraph ?? '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const chars = Array.from(trimmed);
    let start = 0;
    for (let i = 0; i < chars.length; i += 1) {
      if (!SENTENCE_END.test(chars[i])) continue;
      const isAscii = chars[i] === '.' || chars[i] === ';' || chars[i] === '!';
      const next = chars[i + 1];
      if (!isAscii || next === undefined || /\s/.test(next)) {
        const sentence = chars.slice(start, i + 1).join('').trim();
        if (sentence) out.push(sentence);
        start = i + 1;
      }
    }
    const rest = chars.slice(start).join('').trim();
    if (rest) out.push(rest);
  }
  return out;
}

/**
 * 把最终回复压成一句短摘要。
 *
 * **返回 null 表示「没有可用摘要」** —— 调用方据此降级到兜底文案。
 * 不返回空串：空串会让 `state.say` 抛 `EMPTY_TEXT`。
 *
 * **规则**：按「段落 → 行 → 句」顺序找第一条**不是铺垫**的句子；
 * 全篇都是铺垫时退回第一句（总比没有强）。
 *
 * @param {string} text 最终回复正文（`message.committed` 的 `text`）
 * @param {number} [max] 最大长度
 * @returns {string | null}
 */
export function summarize(text, max = SUMMARY_MAX) {
  const stripped = stripMarkdown(text);
  const paragraphs = stripped
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter((para) => para.length > 0);

  if (!paragraphs.length) return null;

  // 收集候选句：按出现顺序
  const candidates = [];
  for (const paragraph of paragraphs) {
    for (const sentence of splitSentences(paragraph)) {
      // 纯符号行（残留的 ---、• 之类）不算内容
      const meaningful = sentence.replace(/[^\p{L}\p{N}]/gu, '');
      if (meaningful.length < MIN_CONTENT) continue;
      candidates.push(sentence);
    }
  }
  if (!candidates.length) return null;

  // 第一条**不是铺垫**的句子
  let summary = candidates.find((sentence) => !isPrelude(sentence));
  if (!summary) summary = candidates[0];

  // 截断
  const chars = Array.from(summary);
  if (chars.length > max) {
    summary = chars.slice(0, max).join('') + '…';
  }
  return summary || null;
}
