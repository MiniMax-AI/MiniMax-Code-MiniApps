// @ts-check

/**
 * 一轮回复怎么变成「多条短消息」—— **切分规则与流式落库的唯一真源**。
 *
 * ============================ 为什么有这个东西 ============================
 *
 * 老板 2026-10-28 纠正口径：
 * 「不要一次只回一句，也不要一次发长句，而是分成几次用短句回复，
 *   这样才符合正常聊天的方式。」
 *
 * 也就是说，一轮回复该长成**好几条短消息**，像真人那样一条一条发出去 ——
 * 不是一条长段落，也不是每次只蹦一句。
 *
 * ============================ 为什么切分放在服务端 ============================
 *
 * 1. **不能靠提示词自觉**。提示词只能让她「倾向于」写短句；写不写、怎么断、
 *    断在哪儿，全看模型当次心情。放到服务端切，才是**结构性保证**：
 *    只要她说了一长段，聊天区里出来的就一定是好几条短消息。
 * 2. **她自己的换行也是断点**。她按引导段写的「一句一行」，
 *    换行处天然就是一条消息的边界 —— 断在她自己的断点上，不算我们替她改写。
 * 3. **和气泡摘要互不干扰**：`summarize.mjs` 管的是「进浮窗的那一句摘要」，
 *    这里管的是「聊天区里的消息条数与长短」。两件事，两个真源，各管各的。
 *
 * ============================ 切分规则 ============================
 *
 * 断点从强到弱：
 *  1. **换行**（她自己的段落）—— 永远断。
 *  2. **句末标点**（。！？）—— 永远断。
 *  3. **从句标点**（，、；：）—— 当这一条已经攒够 `CHUNK_MIN` 个字才断；
 *     不够就攒着，跟后面连成一条（宁可长一点，也不要蹦出「嗯，」这种碎片）。
 *  4. **硬上限** `CHUNK_MAX` —— 攒到上限还没遇到合适的断点，就地断开，
 *     免得出现一整块几百字的「长句」。
 *
 * ⚠️ **规则只写一份**：`Chunker` 是唯一的断句实现，
 * 流式（`ReplyFlow.pushDelta`）和落定（`ReplyFlow.commit`）都走它，
 * 所以「流式看到的边界」和「落库时的边界」必然一致。
 *
 * ⚠️ **前缀稳定**是硬要求：同一条规则跑在「已经收到的一半」和「完整正文」上，
 * 断出来的边界必须一致 —— 否则流式阶段冒出来的气泡和落盘时的正文会对不上。
 * 所以下面每条规则都**只往回看**（只看已经收到的字），不依赖后面的内容。
 *
 * ⚠️ **偏移由切分器给，不由调用方自己数**：
 * 每段都带 `start`/`end`（码点下标），调用方直接拿偏移定位。
 * 自己数偏移会漏掉换行符 —— 那会让流式阶段多发一段（实测踩到：
 * 完整正文切 5 段、流式却 seal 了 6 段）。
 *
 * ⚠️ **偏移一律按码点**（和 `clip.mjs` 的长度口径一致）：
 * emoji 在 JS 字符串里占两个码元，按码元算偏移会劈开代理对。
 */

import { textLength } from './clip.mjs';

/**
 * 一条消息最少多少字才值得单独成条。
 *
 * 低于这个长度的从句不单独断 —— 跟后面连成一条。
 *
 * ⚠️ **2026-10-31 第二十七轮（续）：20 → 30**（老板拍板「降半句率」，
 * 动的是切分器的**规则③**：逗号断点攒够多少字才断）。
 *
 * **为什么**（第二十七轮实测，样本 = 运行时库里 171 条真机回复原文 / 21,395 字）：
 * 历史上 **18/18** 的逗号级半句都是**服务端在行中间按逗号切**出来的，
 * **她自己换行造成的 0 条** ⇒ 半句的主因在服务端断点规则，不在提示词
 * （第二十轮就量出过同一结论，见 `REFERENCE-deepseek-pet-analysis.md` §12.10）。
 *
 * 各档实测（同一样本）：
 * - 20 → 气泡 822 / 逗号级半句 **22.5%** / 非完整句 31.6% / 硬切 75 / 平均 18.5 字
 * - 25 → 气泡 759 / 逗号级半句 15.7% / 非完整句 26.0% / 硬切 78 / 平均 20.1 字
 * - **30 → 气泡 713 / 逗号级半句 9.4% / 非完整句 21.2% / 硬切 84 / 平均 21.4 字**
 * - 35 → 气泡 698 / 逗号级半句 4.6% / 非完整句 19.5% / 硬切 104 / 平均 21.8 字
 * - 40 → 气泡 696 / 逗号级半句 0.9% / 非完整句 19.3% / **硬切 128** / 平均 21.9 字
 *
 * ⚠️ **40 是个陷阱，别被「逗号级半句 0.9%」骗了** ——
 * `CHUNK_MIN` 一旦等于 `CHUNK_MAX`，**逗号规则就彻底失效**（硬上限总在第 40 字先生效，
 * 逗号规则只剩「正好落在第 40 字」这一种情形）⇒ 气泡全部变成**硬切**（75 → 128），
 * 而「非完整句」（末字不是句末标点）卡在 **19.3%** 下不来。
 * ⇒ **30 是拐点**：逗号级半句已经降到 1/4 以下，再往上主要靠「多造硬切」换，
 * 而硬切本身就是另一种半句。气泡数 822 → 713（-13%），平均 18.5 → 21.4 字（仍是一行）。
 *
 * ⚠️ **只改这一个数**，规则本身没动（「攒够 `CHUNK_MIN` 个字才断」）。
 * ⚠️ **纯回头看**：不依赖后面的内容 ⇒ 流式与落定边界必然一致（见上面「前缀稳定」）。
 *
 * ⚠️ **2026-10-29 第九轮：12 → 20**（老板拍板）。
 * 起因是真机实测：她一轮 126 字 / 4 句，页面却冒了 **10 个气泡** ——
 * 10 个里有 6 个是**逗号级「半句」**（「规矩怎么定，」这种）：
 * 逗号只要攒够 12 字就断，而她平均一句 20~30 字、逗号又密。
 * 抬到 20 之后逗号基本不再单独断，**气泡数 ≈ 句数**（实测 10 → 6 / 9 → 7），
 * 气泡也从半截句变成一整句。
 */
export const CHUNK_MIN = 30;

/**
 * **回退护栏的下限** —— 硬上限切点回退时，退回去那一段**至少要这么多字**。
 *
 * ⚠️ **为什么不跟 `CHUNK_MIN` 共用一个数**（第二十七轮续，实测才发现）：
 * - `CHUNK_MIN` 的含义是「**从句标点攒够多少字才断**」（逗号断点门槛）；
 * - 护栏的含义是「**回退后这一段不许太短**」（宁可半句也不要一截碎片）。
 *
 * 这是**两件事**。2026-10-31 把 `CHUNK_MIN` 从 20 抬到 30 时，护栏跟着变严
 * ⇒ **回退少触发了一次**（真机语料实测：词被劈开 3 处 → 4 处，
 * 多出来的那处正是「词离段头只有 21 字」的真机样本）。
 * ⇒ 护栏单独一个数，**固定 20**（回退后剩 20~29 字的段是正常短气泡，不是碎片）。
 */
export const ROLLBACK_MIN = 20;

/**
 * 一条消息最多多少字。
 *
 * 40 字：聊天区气泡宽 78%、13px 字号，40 字大约两行 —— 超过就明显是「一整块」了。
 */
export const CHUNK_MAX = 40;

/**
 * **一轮回复的正文上限**（2026-10-29 第七轮）。
 *
 * ============================ 为什么要有这个 ============================
 *
 * 老板 2026-10-29：「为什么要控制气泡，不是应该控制回复的内容吗」
 * —— 他否掉的是「限制气泡数」（那是**表征**），要治的是**内容**。
 * 本上限治的正是**内容长度**：一轮说太多字。
 *
 * 起因是真机实测：同一句问话，她一轮回了 **820 字 / 42 个气泡**。
 * 提示词加了「一轮写 150 字左右，最多 200 字」之后降到 **399 字 / 17 条** ——
 * ⚠️ **2026-10-29 第九轮把提示词口径压到「100 字左右 + 整轮写 4~6 句」**，
 *    而**这个兜底上限仍是 200**（老板拍板不动）—— 它管的是「失控了别刷屏」，
 *    不是「她应该写多少」；真正常态根本碰不到它。
 * ⚠️ **模型对字数上限也只是大致遵守**（399 > 200），所以提示词是**第一道**，
 * 这一层是**第二道兜底**：她再失控，也不会刷出四五十个气泡。
 *
 * ============================ 为什么放在切分器里 ============================
 *
 * 因为**流式和落定必须同时封口**：
 * 只在落定时截 → 流式阶段已经把超长的内容全广播了，页面会留下一堆
 * 「有内容但没落库」的残泡（id 不对应、刷新还在）。
 * 在**收口那一刻**就停 → 流式看到的就是全部，落定重切也是同一批段，
 * 页面和落库天然一致（§「前缀稳定」那条硬要求）。
 *
 * ⚠️ **200 而不是 240**：按实测密度换算 —— 820 字切出 42 段，
 * 也就是**平均一段约 19.5 字**（标点密的地方切得碎）。
 * 240 字 ≈ 12~14 段，还是偏多；**200 字 ≈ 10~12 段**，才真的把刷屏按住。
 * 提示词那 200 是「她应该写多少」，这一层是「超过多少就不许再写」——
 * 兜底与目标取同一个数，正常偏长的回答（180 字上下）不会被误截。
 *
 * ⚠️ **只管聊天回复**：`splitChunks()` 默认**不限**（提问降级、摘要等路径不受影响），
 * 只有 `ReplyFlow`（一轮回复）这条链路带预算。
 */
export const REPLY_MAX_CHARS = 200;

/**
 * **用户这一条很短时**（规矩第 27 条）的回复预算（第三十七轮）。
 *
 * ⚠️ **为什么要有这一档**：规矩第 27 条说「用户这一条只有几个字……这一轮你就少说两句」，
 *   但那只是**提示** —— 模型不一定照做。REPLY_MAX_CHARS 是「失控了别刷屏」的兜底，
 *   200 字对一句「嗯」来说还是太多。
 * ⚠️ **按块收口，不切半句**：预算收紧时切分器在**段边界**停 ⇒ 不会切出半截话。
 * ⚠️ **只对「用户这一条很短」生效**（≤ chatinput.mjs 的 SHORT_USER_MAX 个字）。
 */
export const REPLY_MAX_CHARS_SHORT = 60;

/** 句末标点 —— 遇到就断。 */
const SOFT_BREAK = /[。！？!?]/;

/** 从句标点 —— 攒够了才断。 */
const CLAUSE_BREAK = /[，、,；;：:]/;

/**
 * **词字符** —— 数字 / 英文字母 + 词内常见符号（`.` `-` `_`）。
 *
 * ⚠️ 存在的唯一理由：**硬上限切点回退**（第二十七轮）。
 * 真机案例：「…里写着 --interval 2」+「000（死参数…」⇒ 数字「2000」被劈成两个气泡。
 */
const WORD_CHAR = /[0-9A-Za-z.\-_]/;

/**
 * 词里至少要有一个字母或数字 ——
 * 不然就只是一个孤零零的句点（「改完了.」），那个句点不该被挪走。
 */
const WORD_ALNUM = /[0-9A-Za-z]/;

/**
 * @typedef {{text: string, start: number, end: number}} Chunk
 */

/**
 * 文本 → 码点数组。
 *
 * `Array.from` 按**码点**拆，代理对（emoji）不会被劈开。
 * @param {unknown} text
 * @returns {string[]}
 */
export function toPoints(text) {
  return Array.from(String(text ?? ''));
}

/**
 * **硬上限切点回退** —— 别把一个「词」劈成两个气泡。
 *
 * ⚠️ **为什么**（第二十七轮真机取证）：那轮真回复里出现了
 *   「残留还是老的：start-bridge.ps1 里写着 --interval 2」+「000（死参数…」
 *   ⇒ 数字「2000」被劈成「2」和「000」，落在两个气泡里。
 *
 * ⚠️ **做法**：切点往前挪到**末尾那串词的起点**，整个词挪到下一段。
 *   这几种情况**不**回退：
 *   ① 末尾不是词字符（本来就断在词后面）；
 *   ② 整段都是同一个词（退回去就成空段了）；
 *   ③ 那串词里没有字母/数字（只是个孤零零的句点）；
 *   ④ 退回去之后这一段会短于 `ROLLBACK_MIN`（宁可半句也不要一截碎片）。
 *
 * ⚠️ **只能用「回头看」可定的信息**（已经收到的字）——
 *   任何向前看的规则会让流式与落定分歧（项目硬要求：前缀稳定）。
 *
 * ⚠️ **不回退 `capAt`**（200 字预算封口）—— 退回会丢更多内容。
 *
 * @param {string[]} points 全文码点
 * @param {number} start 当前段起点（码点下标）
 * @param {number} i 硬上限触发时的下标（含）
 * @returns {number} 切点（码点下标，不含）
 */
function rollbackWordRun(points, start, i) {
  const hard = i + 1;
  if (i < start) return hard;
  if (!WORD_CHAR.test(points[i])) return hard;
  let runStart = i;
  while (runStart > start && WORD_CHAR.test(points[runStart - 1])) runStart -= 1;
  // 整段都是同一个词 ⇒ 退回去就是空段，不退。
  if (runStart <= start) return hard;
  let hasAlnum = false;
  for (let k = runStart; k <= i; k += 1) {
    if (WORD_ALNUM.test(points[k])) {
      hasAlnum = true;
      break;
    }
  }
  // 只是个孤零零的句点（「改完了.」）⇒ 那是句末标点，不该挪走。
  if (!hasAlnum) return hard;
  // 退回去会剩一截碎片 ⇒ 宁可半句也不要碎片。
  // ⚠️ **用 `ROLLBACK_MIN`（20），不用 `CHUNK_MIN`** —— 两个数含义不同（见常量说明）。
  if (runStart - start < ROLLBACK_MIN) return hard;
  return runStart;
}

/**
 * 收口一段。
 *
 * ⚠️ **trim 后为空的段不收**（比如连续两个换行中间那段）：
 * 丢掉它，「段序号」才和「消息序号」一一对应 ——
 * 否则流式段序号会比落定多一位，id 整体错位。
 *
 * @param {string[]} points 全文的码点数组
 * @param {number} start 段起点（码点下标）
 * @param {number} end 段终点（码点下标，不含）
 * @param {Chunk[]} closed 全部收口列表
 * @param {Chunk[]} fresh 本次新收口的段
 */
function closeSegment(points, start, end, closed, fresh) {
  const text = points.slice(start, end).join('');
  if (!text.trim()) return;
  const chunk = { text, start, end };
  closed.push(chunk);
  fresh.push(chunk);
}

/**
 * 断句器 —— **切分规则的唯一实现**。
 *
 * 增量喂码点进去，它吐出「刚刚收口的段」和「还在长的尾段」。
 * 流式和落定共用它，所以两边的断点必然一致。
 */
export class Chunker {
  /**
   * @param {number} [maxChars] 一轮正文的字数上限（0 = 不限）
   */
  constructor(maxChars = 0) {
    /** @type {string[]} 全文的码点 */
    this.points = [];
    /** 当前段的起点（码点下标） */
    this.start = 0;
    /** 已经检查过的位置（码点下标） */
    this.scanned = 0;
    /** @type {Chunk[]} 已收口的段 */
    this.closed = [];
    /** 字数上限（0 = 不限） */
    this.maxChars = Math.max(0, Number(maxChars) || 0);
    /** 是否已经因超预算封口 */
    this.capped = false;
    /**
     * 「……」落在了**上一条**身上（预算边界正好是断点时）。
     * 那一条可能已经流式播出去了 → 调用方要**重新 seal 一次**（按 id 覆盖）。
     * @type {boolean}
     */
    this.tailReSeal = false;
  }

  /** 已经收到的字数（码点） */
  get length() {
    return this.points.length;
  }

  /**
   * 超预算 → **就地封口**：把当前这一段收成最后一条，并加「……」。
   *
   * ⚠️ **为什么加「……」**：规矩 22 写着「……表示话没说完、迟疑、有点不好意思」。
   * 被截掉的话**不是丢掉就算了** —— 留个记号，她像话说了一半。
   * （老板口径：内容要对，不是悄悄切一刀。）
   *
   * @param {number} end 段终点（码点下标，不含）
   * @param {Chunk[]} fresh 本次新收口的段
   */
  capAt(end, fresh) {
    const before = this.closed.length;
    closeSegment(this.points, this.start, end, this.closed, fresh);
    const last = this.closed[this.closed.length - 1];
    if (last && !last.text.endsWith('……')) last.text = `${last.text}……`;
    // ⚠️ **断点正好落在预算边界上时，这一段是空的** ——
    //    `closeSegment` 遇到空段不收，于是「……」被加到了**上一条**身上，
    //    而上一条可能已经流式播出去了（事后改不得）→ 流式比落定少两个字符
    //    （实测：页面 200 字 / 落库 202 字，泡和正文对不上）。
    //    记下来，让 `ReplyFlow.pushDelta` 把上一条**重新 seal 一次**。
    this.tailReSeal = this.closed.length === before && this.closed.length > 0;
    this.capped = true;
  }

  /**
   * 喂一段增量，返回**这一次新收口**的段。
   *
   * 已收口的段不会因为后续内容而改变 —— 规则只往回看。
   *
   * @param {string} piece
   * @returns {Chunk[]}
   */
  feed(piece) {
    const fresh = [];
    // 已经封口 → 后面一个字都不再收。
    if (this.capped) return fresh;
    this.points.push(...toPoints(piece));

    for (let i = this.scanned; i < this.points.length; i += 1) {
      // ⓪ 字数预算：收到的字数到顶了就地封口（流式和落定同一处停 → 边界一致）。
      if (this.maxChars > 0 && i >= this.maxChars) {
        this.capAt(i, fresh);
        this.scanned = this.points.length;
        return fresh;
      }

      const ch = this.points[i];

      // ① 换行：她自己的断点，永远断（换行符本身不带走）
      if (ch === '\n') {
        closeSegment(this.points, this.start, i, this.closed, fresh);
        this.start = i + 1;
        continue;
      }

      // ② 句末标点：永远断
      if (SOFT_BREAK.test(ch)) {
        closeSegment(this.points, this.start, i + 1, this.closed, fresh);
        this.start = i + 1;
        continue;
      }

      const head = this.points.slice(this.start, i + 1).join('');

      // ③ 从句标点：攒够 CHUNK_MIN 才断，否则攒着跟后面连成一条
      if (CLAUSE_BREAK.test(ch) && textLength(head) >= CHUNK_MIN) {
        closeSegment(this.points, this.start, i + 1, this.closed, fresh);
        this.start = i + 1;
        continue;
      }

      // ④ 硬上限：到顶了就地断（宁可断在半句里，也不要一整块几百字）
      if (textLength(head) >= CHUNK_MAX) {
        // ⚠️ **第二十七轮：切点回退** —— 别把一个「词」劈成两个气泡
        //   （真机案例：「…里写着 --interval 2」+「000（死参数…」⇒ 「2000」被劈开）。
        //   切点往前挪到末尾那串词的起点，词整个挪到下一段。
        //   ⚠️ **不回退 `capAt`**（200 字预算封口）—— 退回会丢更多内容。
        const cut = rollbackWordRun(this.points, this.start, i);
        closeSegment(this.points, this.start, cut, this.closed, fresh);
        this.start = cut;
      }
    }

    this.scanned = this.points.length;
    return fresh;
  }

  /**
   * 还没收口的尾段（流式阶段它还在长）。
   * @returns {Chunk}
   */
  open() {
    return {
      text: this.points.slice(this.start).join(''),
      start: this.start,
      end: this.points.length,
    };
  }

  /**
   * 从某个码点下标往后取正文（尾段用）。
   * @param {number} from
   * @returns {string}
   */
  sliceFrom(from) {
    return this.points.slice(from).join('');
  }

  /**
   * 全部收口 —— 已断开的段 + 尾段（尾段非空才算一条）。
   *
   * ⚠️ **封口后没有尾段**：超预算时那一段已经被 `capAt` 收成最后一条了，
   * 尾巴（还没遇到断点的部分）**不再单独成条** —— 否则会突破预算。
   *
   * @returns {string[]}
   */
  finish() {
    const parts = this.closed.map((chunk) => chunk.text.trim()).filter(Boolean);
    if (!this.capped) {
      const tail = this.open().text.trim();
      if (tail) parts.push(tail);
    }
    return parts;
  }
}

/**
 * 切一段文本：切出**已经收口**的若干段，剩下没写完的部分作为尾巴返回。
 *
 * 「尾巴」= 还没遇到断点的部分（流式阶段它还在长）。
 * 落定阶段（正文已完整）用 `splitChunks`，尾巴会作为最后一条落库。
 *
 * ⚠️ 每段带 `start`/`end`（**码点**下标），调用方拿偏移定位，别自己数。
 *
 * @param {unknown} text
 * @returns {{closed: Chunk[], open: Chunk}}
 */
export function cutChunks(text) {
  const chunker = new Chunker();
  chunker.feed(String(text ?? ''));
  return { closed: chunker.closed.slice(), open: chunker.open() };
}

/**
 * 切一段**完整**的文本成多条短消息。
 *
 * 落定时用这个：尾巴（没遇到断点的最后一段）也算一条。
 *
 * ⚠️ `maxChars` **默认 0 = 不限** —— 只有「一轮回复」那条链路
 * （`ReplyFlow`）才带预算。提问降级、摘要等路径**不受这个上限影响**。
 *
 * @param {unknown} text
 * @param {number} [maxChars] 字数上限（0 = 不限）
 * @returns {string[]}
 */
export function splitChunks(text, maxChars = 0) {
  const chunker = new Chunker(maxChars);
  chunker.feed(String(text ?? ''));
  return chunker.finish();
}

/**
 * 一轮回复的流式切分状态机。
 *
 * ============================ 它在干什么 ============================
 *
 * 宿主把她的回复**流式**送过来（`text.delta`）。我们要在它到达的同时
 * 就决定「这一条到这儿结束了，下一条另起一个气泡」——
 * 这样用户看到的就是**一条一条冒出来的短消息**，而不是一条越滚越长的段落。
 *
 * ============================ 流式与落定怎么对齐 ============================
 *
 * 宿主保证 `message.committed` 带**完整正文**，而且那才是权威（规范原文：
 * `text.delta` 在事件积压时**可能被丢**）。所以：
 *
 *  - **流式**（`pushDelta`）只做「乐观预告」：按同一套切分规则把断点提前露出来。
 *  - **落定**（`commit`）用完整正文重切一遍，**复用流式已经分配好的消息 id**，
 *    文本以完整正文为准（upsert 覆盖页面上那个气泡）。
 *
 * 于是：流式漏了字 → 落定补发新 id 的段；流式多切了 → 落定按 id 覆盖回去。
 * 两种情况页面上都不会留下对不上的气泡。
 */
export class ReplyFlow {
  /**
   * @param {() => string} allocId 分配消息 id 的发号器
   * @param {number} [maxChars] 这一轮的字数预算（默认 REPLY_MAX_CHARS）
   */
  constructor(allocId, maxChars = REPLY_MAX_CHARS) {
    /** @type {() => string} */
    this.allocId = allocId;
    /** 这一轮的字数预算（第三十七轮：随用户这一条的长短收紧） */
    this.maxChars = Number(maxChars) > 0 ? Number(maxChars) : REPLY_MAX_CHARS;
    /** @type {string[]} 消息 id，按顺序 */
    this.ids = [];
    /** 本轮已定稿的消息条数（流式与落定共用的 id 基准） */
    this.base = 0;
    /** 本条 committed 已经预告出去多少段 */
    this.announced = 0;
    /** 断句器（和落定共用同一套规则；带一轮字数上限） */
    this.chunker = new Chunker(this.maxChars);
    /** 已经广播出去的字数（码点） */
    this.sentLen = 0;
    /**
     * 流式预告过、但落定时没有对应正文的段 id（正常情况下为空）。
     * 留着是为了「出问题时能查」，不是用来处理的。
     * @type {string[]}
     */
    this.orphanIds = [];
  }

  /**
   * 取第 index 条消息的 id（不够就现场发号）。
   * @param {number} index
   * @returns {string}
   */
  idFor(index) {
    while (this.ids.length <= index) this.ids.push(this.allocId());
    return this.ids[index];
  }

  /**
   * 喂进来一段增量，返回要广播的动作。
   *
   * 动作有两种：
   *  - `seal`：这一条收口了，用整条正文把气泡定稿（客户端按 id 覆盖，不追加）。
   *  - `delta`：当前这条还在长，往当前气泡追加。
   *
   * @param {string} piece
   * @returns {{kind: 'seal'|'delta', id: string, text: string}[]}
   */
  pushDelta(piece) {
    /** @type {{kind: 'seal'|'delta', id: string, text: string}[]} */
    const actions = [];

    const fresh = this.chunker.feed(piece);
    for (let i = 0; i < fresh.length; i += 1) {
      actions.push({
        kind: 'seal',
        id: this.idFor(this.base + this.announced + i),
        text: fresh[i].text.trim(),
      });
    }
    // ⚠️ 「……」有可能落在**已经播出去**的上一条上（预算边界正好是断点）。
    //    那一条要**重新 seal 一次**（客户端按 id 覆盖，不追加）——
    //    不补这一步，页面上的正文就比落库的少两个字符（实测 200 vs 202）。
    if (this.chunker.tailReSeal) {
      const lastIdx = this.chunker.closed.length - 1;
      actions.push({
        kind: 'seal',
        id: this.idFor(this.base + lastIdx),
        text: this.chunker.closed[lastIdx].text.trim(),
      });
      this.chunker.tailReSeal = false;
    }
    this.announced += fresh.length;

    // 还在长的那段：只播没播过的部分。
    // ⚠️ 起点用 `open.start`（断句器给的偏移）——自己数会漏掉换行符。
    //
    // ⚠️ **封口之后不再播尾段**：字数到顶时那一段已经被收成最后一条了
    // （`capAt`），再播尾段就会突破预算、也会多出一个对不上的气泡。
    if (!this.chunker.capped) {
      const open = this.chunker.open();
      const from = Math.max(this.sentLen, open.start);
      const tail = this.chunker.sliceFrom(from);
      if (tail) {
        actions.push({ kind: 'delta', id: this.idFor(this.base + this.announced), text: tail });
      }
    }
    this.sentLen = this.chunker.length;
    return actions;
  }

  /**
   * 落定：一条完整正文 → 若干条短消息。
   *
   * **id 复用流式已经分配好的**（同一条 committed 在流式和落定里是同一批气泡）。
   * 流式漏字导致预告段数不够时，这里补发新 id。
   *
   * @param {string} text 这一条 committed 的完整正文
   * @returns {{id: string, text: string}[]}
   */
  commit(text) {
    // ⚠️ **带上一轮的字数上限** —— 和流式同一处停，所以落定的段与流式预告的一致。
    const parts = splitChunks(text, REPLY_MAX_CHARS);
    const out = [];
    for (let i = 0; i < parts.length; i += 1) {
      out.push({ id: this.idFor(this.base + i), text: parts[i] });
    }

    // 流式预告过、但这次正文里没有的段 —— 记下来（正常情况下是空的）。
    if (this.announced > parts.length) {
      for (let i = parts.length; i < this.announced; i += 1) {
        this.orphanIds.push(this.ids[this.base + i]);
      }
    }

    // 这一条 committed 收工：下一条从新的 base 接着发号。
    this.base += parts.length;
    this.announced = 0;
    this.chunker = new Chunker(this.maxChars);
    this.sentLen = 0;
    return out;
  }
}
