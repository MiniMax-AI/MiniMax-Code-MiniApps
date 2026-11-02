/**
 * 落库前**剥皮** —— 她的话进聊天区之前，先把「工作日志味」擦掉。
 *
 * ⚠️ **抄机制，不抄内容** —— 剥 markdown 这一步抄 Aurabot 的
 * `src/chat/reply.js` 的 `stripMarkdown`（服务端全量剥）；
 * 「预告句 / 路径 / 校验味」这三道是我们自己的口径（老板 2026-10-31 第二十九轮）。
 *
 * **为什么要有这一层**（老板 2026-10-31 真机抓到）：
 * 她在闲聊里真的去调工具翻源码，还把过程和路径报了出来：
 * 「这个我得去翻源码才敢讲细，我去把 dsp1、dsp2 的代码找出来。」
 * 规矩第 1 条早就写了「不要报『我去看一下』『我查一下』『我跑一下』」，
 * 但那是**提示词层**的叮嘱 —— 模型偶尔不照做，服务端得有一道兜底。
 *
 * ⚠️ **老板的口径（2026-10-31）**：「她可以知道很多事情，而且她需要知道更多这种梗
 * 才更有真实感」⇒ **本模块只擦「工作日志味」，不擦「她懂很多」**：
 * 聊外部项目、说梗、讲细节都**照常放行**；只擦两种痕迹：
 * ① **预告句**（「我去把 X 的代码翻出来看一眼再回你」）；
 * ② **路径 / 校验味句**（整句主体就是 `C:\Users\...`、`47 万字符` 这种）。
 *
 * ⚠️ **误伤率是量出来的，不是拍的**（真机 163 条她的回复）：
 * 宽口径（含动作动词 + 工作词）会命中 **11 句**，其中 **7 句是正常内容**
 * （「dsp1、dsp2 那两份源码我也见过」这种）⇒ 宽口径**不能用**。
 * 窄口径（**我 + 去/先/得去 + 工作词**，必须都在同一句里）只命中 **5 句**，
 * 且 **5 句全是「我去查/我去翻」那种预告** ⇒ 零误伤，**这才用**。
 *
 * ⚠️ **窄口径之外还有第二道：报过程短语**（真机漏网后才加的）：
 *   窄口径只看「预告动词 + 工作词」，于是「我去把今天那几个会话的进度翻出来看一眼」
 *   「我用命令行实地看一下」「我算一下分类小计」全都漏了 ⇒ 她还是在报过程。
 * ⇒ **第二道判据**：**我 + 动作 + 一下/一遍/一眼**（补语后不许跟「了」）。
 *   真机 163 条实测：命中 **8 句**，**8 句全是报过程，零误伤**；
 *   「我盯着看了一会儿」「我数着呢」「我查了黑龙江几个城市」「我看过一遍了」都不命中。
 *   模糊动作（看/找/查/读/试/搜）还要**同句有工作语境**才算 ⇒「我看一眼猫粮」不算。
 *
 * ⚠️ **动作只有两种：整句去掉 / 整句留下** ——
 * 中间粒度全炸过，写在这里当教训：
 * · **句内挖词** ⇒ 「一个 47 万字符的 `桌宠.py`」留「一个 的 桌宠.py」；
 *   「dsp2 在 `Temp\dsp2` 里」留「dsp2 在 里」——**破洞**；
 * · **逗号切片段** ⇒ 「，也永远断。」丢了逗号；
 *   英文台词「You're right, let me reconsider」被劈成两半（老板明确说要保留这种真实感）；
 * · **破洞检测**（「连接词后面空了」）⇒ 把「知道，Anthropic 那家的。」
 *   「一段一段捋完了。」全杀了（真机 25 条被误删）。
 * · **只截尾**（技术味挂在半句末尾 ⇒ 只砍尾巴留前面）⇒ 真机语料实测（158 条她的回复）：
 *   改动条数一样（12 条），但**多留一句过去式过程味**——
 *   「那条鱼我翻到了源码🌿」（原文「那条鱼我翻到了源码，是老板你自己做的那只——
 *   dsp2 in Temp\dsp2 里🌿」）⇒ 「我翻到了源码」正是老板要修的那件事
 *   ⇒ **只截尾不可用**；再加一道「残留过程味也砍掉」⇒ 和整句去掉**逐条输出一模一样**
 *   ⇒ 多一层粒度换来零收益 ⇒ **维持整句去掉**（2026-10-31 实测，别再翻案）。
 * ⇒ **规则**：
 *   ① 预告句 ⇒ 去掉**预告那半句**（含它紧跟的解释半句）；前半句有结果就留着；
 *      切完把尾部那个分隔符带走（不留悬空的「，」）；
 *   ② 句子里有路径或过程味 ⇒ **整句去掉**（不挖词 ⇒ 不可能留破洞）；
 *   ③ 其余句子 ⇒ **一个字都不动**。
 *
 * ⚠️ **被去掉的句子里的表情要抢救** —— 否则一条消息里唯一的表情会跟着句子一起没了
 *（老板 2026-10-31 刚修过一轮「连着两轮什么都没有」，不能再制造同类问题）。
 *
 * ⚠️ **剥空了怎么办**（2026-10-31 真机实测改口径）：
 *   真机 158 条她的回复里，剥皮会**整条剥空 14 条**（全是「我去翻源码」「我去看脚本」那种预告）。
 *   老口径「剥空 ⇒ 回退原话」⇒ 这 14 条**原样落进 chat.json**
 *   ⇒ 老板报的「她在闲聊里真的去调工具翻源码 + 报过程」**根本没修掉**。
 * ⇒ **新口径**：
 *   ① 剥空 ⇒ **这条不落库**（chat.json 里不留痕）；
 *   ② 页面上那个气泡**也要撤掉**（同一个 id 广播一条空文本 ⇒ 客户端按 id 覆盖）；
 *   ③ **整轮全被剥空** ⇒ 保留第一条原话（宁可漏杀一次，也不给老板一个死轮）
 *      —— 真机 35 轮里 **0 次**触发 ⇒ 这是兜底，不是常态。
 *
 * **纯函数，无副作用** —— 自检直接 import 它跑。
 */

export const WORK_WORDS = [
  '源码', '代码', '文件', '目录', '路径', '行号', '字符', '脚本', '仓库', '分支', '堆栈', '日志',
  // ⚠️ **「进度」也是工作语境**（真机 2026-10-31 抓到）：
  //   「我去把今天那几个会话的进度翻出来看一眼」—— 有预告动词但工作词一个不沾
  //   ⇒ 窄口径漏了它。进度 = 干活的状态 ⇒ 算工作词。
  '进度',
];

export const PREVIEW_MARKS = [
  '我去', '我先', '我得去', '我要去', '我正在', '我接着', '我这就', '我打算',
  // ⚠️ **「这就」也算预告**（真机 2026-10-31 抓到）：
  //   「这就去翻，目录和文件都得一个个数给你看。」—— 没有「我」，窄口径漏了它。
  '这就',
];

/**
 * **清晰的工作动作** —— 出现即「她在报过程」。
 * （翻源码 / 数行 / 算小计 / 跑脚本 / 核实一遍 …）
 */
export const WORK_VERBS = [
  '翻', '数', '算', '扫', '跑', '量', '统计', '核对', '清点', '遍历', '扒', '核实', '执行',
];

/**
 * **过程短语** —— 「动作 + 一下 / 一遍 / 一眼 / 一通 / 一遭」。
 *
 * ⚠️ **补语后面不许跟「了」**（真机 2026-10-31 实测）：
 *   「我看一眼」= 正在干（要剥）；「我看过一遍了」= 干完了（正常话，不许剥）。
 * ⚠️ **必须带「我」** —— 没有第一人称就不是她在报过程。
 */
export const PROC_PHRASE_PATTERN =
  /(翻|统计|核对|清点|遍历|执行|核实|数|算|扫|跑|量|扒|看|找|查|读|试|搜)(过)?一?(下|遍|眼|通|遭)(?!了)/;

/**
 * 剥 markdown 记号（**抄 Aurabot `src/chat/reply.js:15` 的 `stripMarkdown`**）。
 *
 * ⚠️ **本模块目前不调用它** —— 剥 markdown 是**行为变更**，老板没要求；
 *   规矩第 21 条（别用 markdown 记号）是**提示词层**的要求，由真源治。
 *   抄 Aurabot 的机制先放在这儿，等要开「服务端剥 markdown」那一轮时直接用。
 */
export function stripMarkdown(text) {
  if (!text) return '';
  return String(text)
    .replace(/```[a-zA-Z0-9_-]*\n?([\s\S]*?)```/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1$2')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 $2')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * 这一句是不是「预告要去干活」。
 *
 * **窄口径**（真机量过，零误伤）：
 * ① 句子里有**预告动词**（我去 / 我先 / 我得去 …），**且位置在句首附近**；
 * ② **同一句里**还有**工作词**（源码 / 代码 / 文件 …）。
 *
 * ⚠️ **为什么两个条件必须同时成立**：
 * 只看工作词 ⇒ 「dsp1、dsp2 那两份源码我也见过」被误杀（真机 7 句正常内容）；
 * 只看预告动词 ⇒ 「我先不画猫了，改画这几颗水珠」被误杀。
 */
export function isPreviewSentence(sentence) {
  if (!sentence) return false;
  const head = sentence.slice(0, 16);
  const hasMark = PREVIEW_MARKS.some((m) => head.includes(m));
  if (!hasMark) return false;
  return WORK_WORDS.some((w) => sentence.includes(w));
}

/**
 * 这一**半句**是不是「预告那半句」。
 *
 * ⚠️ **只看预告词，不再看工作词** —— 整句层面已经查过工作词了（`isPreviewSentence`）。
 *   真机 2026-10-31 第二十九轮抓到过这个坑：
 *   「我去数一遍，用脚本数不靠目测——那次的教训我还记着。」
 *   ⇒ 预告词「我去」在**前半句**、工作词「脚本」在**后半句**（逗号隔开）；
 *   老口径在两个半句上**双双落空**（前半句没工作词、后半句没预告词）
 *   ⇒ 整句原样留着 ⇒ **越界原样进聊天区**。
 *   ⇒ 定位「预告那半句」只认预告词；**工作词是整句的事，不是半句的事**。
 */
export function isPreviewHalf(half) {
  if (!half) return false;
  const head = half.slice(0, 16);
  return PREVIEW_MARKS.some((m) => head.includes(m));
}

/**
 * 这一句是不是「在报过程」——第一人称 + 过程短语。
 *
 * ⭐ **这是窄口径之外的第二道**（真机 2026-10-31 抓到漏网后才加的）：
 *   窄口径只看「预告动词 + 工作词」，于是下面这些说法全都漏了 ——
 *   「我去把今天那几个会话的进度翻出来看一眼」
 *   「我用命令行实地看一下」
 *   「我算一下分类小计」
 *   ⇒ 她还是在报过程，老板看到的还是「她在干活」。
 *
 * ⚠️ **误伤率是量出来的**（真机 163 条她的回复）：
 *   「我 + 动作 + 一下/一遍/一眼」命中 **8 句**，**8 句全是报过程，零误伤**；
 *   「我盯着看了一会儿」「我数着呢」「我查了黑龙江几个城市」都不命中
 *   （「了」在动作和补语中间 ⇒ 事情做完了 ⇒ 不是正在报过程）。
 *
 * ⚠️ **模糊动作（看/找/查/读/试/搜）要有工作语境才算**：
 *   「我看一眼」可能是「我看一眼猫粮」—— 那不是干活 ⇒ 同句得有工作词。
 *   清晰工作动作（翻/数/算/跑/统计…）则不必。
 *
 * @param {string} sentence
 * @returns {boolean}
 */
export function hasProcessPhrase(sentence) {
  if (!sentence || !String(sentence).includes('我')) return false;
  const src = String(sentence);
  const re = new RegExp(PROC_PHRASE_PATTERN.source, 'g');
  const hasWorkWord = WORK_WORDS.some((w) => src.includes(w));
  let m;
  let looseHit = false;
  while ((m = re.exec(src)) !== null) {
    if (WORK_VERBS.includes(m[1])) return true;
    looseHit = true;
  }
  return looseHit && hasWorkWord;
}

/**
 * 定位「报过程」那半句的下标；找不到返回 -1。
 *
 * ⚠️ **半句定位和整句判定用同一套规则**（清晰工作动作，或模糊动作 + 工作语境）
 *   —— 两边口径不一致 ⇒ 整句判了却定位不到 ⇒ 会退化成整句去掉（过度杀伤）。
 *
 * @param {string} sentence
 * @returns {number}
 */
export function findProcessHalf(sentence) {
  if (!sentence) return -1;
  const halves = splitHalves(sentence);
  const hasWorkWord = WORK_WORDS.some((w) => String(sentence).includes(w));
  for (let i = 0; i < halves.length; i += 1) {
    const m = halves[i].match(PROC_PHRASE_PATTERN);
    if (!m) continue;
    if (WORK_VERBS.includes(m[1])) return i;
    if (hasWorkWord) return i;
  }
  return -1;
}

/**
 * 路径形态 —— 盘符路径、目录分隔的相对路径。
 * ⚠️ **只认「带分隔符的路径」** —— 「桌宠.py」这种**文件名不算路径**
 * （它可以是内容的一部分，老板要的是「她知道很多」）。
 * ⚠️ **必须能匹配「以反斜杠结尾」的截断形态** —— 真机里路径跨气泡被切开了
 * （`miniapps\mmx-octopus\` 后面接下一条气泡），漏了它就等于没拦。
 */
export const PATH_PATTERNS = [
  /[A-Za-z]:\\[^\s，。！？、；："'\u3000]+/g,
  /(?:[A-Za-z0-9_.\-]+\\)+[A-Za-z0-9_.\-]*/g,
];

/**
 * 校验味 —— 搬数字（「47 万字符」「1200 行」）。
 * ⚠️ **只认「数字 + 技术单位」**，普通数字（几点几分钟、CHUNK_MIN 就是 30）**不动**。
 */
export const VERIFY_PATTERN = /[0-9]+(?:\.[0-9]+)?\s*[万亿]?\s*[0-9]*\s*(?:字符|字节|行代码|KB|MB|GB|行)/g;

/**
 * 干活动词 —— 她**正在干**的动词。
 *
 * ⚠️ **为什么必须有它**（真机 2026-10-31 第二十九轮抓到）：
 *   老板问「那个项目一共多少行代码」，她答「桌宠.py 一个文件就占 10012 行（代码 8311）」
 *   —— 这是**老板直接要的结果**，不是过程味；
 *   老口径只看「数字 + 技术单位」⇒ 这条被整句剥掉 ⇒ **老板要的回答没了**。
 *   ⇒ **过程味 = 数字 + 技术单位 + 在干活**。
 *   「刚把老板那条鱼翻了个底朝天——47 万字符的源码」有「翻」⇒ 过程味 ⇒ 剥；
 *   「10012 行（代码 8311）」没有干活动词 ⇒ 结果 ⇒ **留着**。
 */
export const WORK_ACTION_WORDS = [
  '翻', '数', '扫', '量', '统计', '核对', '清点', '遍历', '跑', '查完', '扒',
];

/** 表情 —— 抢救用（整句被去掉时，里面的表情不能跟着一起没）。 */
export const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu;

/**
 * 把一句切成「句」。
 *
 * ⚠️ **只按句末标点切（。！？!? 和换行）** ——
 * 逗号、顿号、分号、破折号**不切**（切了 ⇒ 英文台词被劈成两半）。
 *
 * ⚠️ **英文撇号 `'` 和英文句点 `.` 都不切**（2026-10-31 第二十九轮自检核过）：
 *   撇号切 ⇒「You're right」被劈成「You」+「're right」（老板明确要保留的那种真实感）；
 *   句点切 ⇒「3.14」「dsp1.py」这种被劈成两半。
 *   ⇒ 切分集合**一个不多**：只有 `。！？!?` 和换行。
 */
export function splitSentences(text) {
  if (!text) return [];
  const out = [];
  let cur = '';
  for (const ch of String(text)) {
    cur += ch;
    if ('。！？!?'.includes(ch) || ch === '\n') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * 把一句切成「半句」（按逗号/分号切，**分隔符留在前一半**）。
 *
 * ⚠️ **分隔符必须跟着前一半** —— 切丢了标点，句子读不通。
 * ⚠️ **顿号「、」不切** —— 它分隔**并列词**不是分句：
 *   「我去把 dsp1、dsp2 的代码找出来」若在「、」后切 ⇒ 留「dsp2 的代码找出来。」**残句**。
 * ⚠️ **破折号不切** —— 两边常是「结论——补充」，切了会碎。
 * ⚠️ **英文逗号 `,` 不切**（真机 2026-10-31 第二十九轮抓到）：
 *   「You're right, let me reconsider」在英文逗号处被劈 ⇒ 老板明确要保留的那种真实感碎了。
 *   ⇒ 只认**全角**逗号「，」和分号「；」。
 */
export function splitHalves(sentence) {
  if (!sentence) return [];
  const out = [];
  let cur = '';
  for (const ch of String(sentence)) {
    cur += ch;
    if ('，；'.includes(ch)) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** 这句话有没有正经字（剥掉记号和标点之后）。 */
export function hasSolidText(t) {
  if (!t) return false;
  const solid = t.replace(/[\s，。！？、；：,.!?;:'"\u3000~～]/g, '');
  return solid.length > 0;
}

/**
 * 这句话里有没有**路径**。
 *
 * ⚠️ **只认「带分隔符的路径」** —— 「桌宠.py」这种**文件名不算路径**。
 */
export function hasPath(sentence) {
  if (!sentence) return false;
  for (const re of PATH_PATTERNS) {
    if (re.test(sentence)) {
      re.lastIndex = 0;
      return true;
    }
    re.lastIndex = 0;
  }
  return false;
}

/**
 * 这句话是不是「在**报过程**」——搬数字 + 在干活。
 *
 * ⚠️ **必须有干活动词**（真机 2026-10-31 第二十九轮抓到）：
 *   老板问「一共多少行代码」，她答「10012 行（代码 8311）」⇒ **老板要的结果**，不能剥；
 *   她说「刚把那条鱼翻了个底朝天——47 万字符的源码」⇒ **在报过程**，要剥。
 *   差别只在那一个动词（「翻」）—— 数字本身分不出过程还是结果。
 */
export function hasProcessStats(sentence) {
  if (!sentence) return false;
  if (!VERIFY_PATTERN.test(sentence)) {
    VERIFY_PATTERN.lastIndex = 0;
    return false;
  }
  VERIFY_PATTERN.lastIndex = 0;
  return WORK_ACTION_WORDS.some((w) => sentence.includes(w));
}

/**
 * 这句话是不是「整句主体就是路径/过程味」。
 *
 * **判据**：句子里**有路径**，或**在报过程** ⇒ 整句去掉。
 *
 * ⚠️ **为什么不做「挖掉那一小块」**：真机三种挖法都留破洞 ——
 *   「一个 47 万字符的 `桌宠.py`」⇒ 留「一个 的 桌宠.py」；
 *   「真源在 `…\replyflow.mjs`」⇒ 留「真源在 。」；
 *   「…——dsp2 在 `Temp\dsp2` 里」⇒ 留「…dsp2 在 里」。
 * ⇒ **宁可整句去掉，也不留破洞**。
 */
export function isTechnicalSentence(sentence) {
  if (!sentence) return false;
  return hasPath(sentence) || hasProcessStats(sentence);
}

/**
 * 剥一颗（一句）。
 *
 * **两条，互相独立**：
 * ① 预告句 ⇒ 去掉**预告那半句**（含它紧跟的解释半句）；前半句有结果就留着；
 * ② 句子里有路径/校验味 ⇒ **整句去掉**；
 * ③ 其余 ⇒ **一个字都不动**。
 */
export function scrubSentence(sentence) {
  if (!sentence) return { text: '', dropped: false, preview: false, salvaged: '' };
  const salv = (sentence.match(EMOJI_PATTERN) || []).join('');
  if (isPreviewSentence(sentence)) {
    const halves = splitHalves(sentence);
    // ⚠️ **定位「预告那半句」只认预告词**（工作词是整句的事 —— 见 isPreviewHalf 的说明）。
    const at = halves.findIndex((h) => isPreviewHalf(h));
    if (at < 0) {
      // 整句判了预告、却定位不到预告那半句 ⇒ **宁可整句去掉**，也不把预告原样留着。
      return { text: '', dropped: true, preview: true, salvaged: salv };
    }
    // 预告那半句 + 它紧跟的解释半句一起去掉；**前半句有结果就留着**。
    // ⚠️ **切完把尾部那个分隔符带走** —— 「找到订货小程序在 D 盘了，」这种悬空的逗号
    //   是切出来的破渣（老板第二十七轮刚压过非完整句率）⇒ 不能留。
    const kept = halves.slice(0, at).join('').replace(/[，；、]+\s*$/, '');
    if (hasSolidText(kept)) {
      return { text: kept, dropped: false, preview: true, salvaged: '' };
    }
    return { text: '', dropped: true, preview: true, salvaged: salv };
  }
  if (hasProcessPhrase(sentence)) {
    // 报过程 ⇒ 切到那半句为止（前半句有结果就留着；后面那些半句都是她在解释自己怎么干的）。
    const at = findProcessHalf(sentence);
    if (at < 0) {
      // 整句判了报过程、却定位不到那半句 ⇒ **宁可整句去掉**，也不把过程味原样留着。
      return { text: '', dropped: true, preview: false, salvaged: salv };
    }
    const kept = splitHalves(sentence).slice(0, at).join('').replace(/[，；、]+\s*$/, '');
    if (hasSolidText(kept)) {
      return { text: kept, dropped: false, preview: false, salvaged: '' };
    }
    return { text: '', dropped: true, preview: false, salvaged: salv };
  }
  if (isTechnicalSentence(sentence)) {
    return { text: '', dropped: true, preview: false, salvaged: salv };
  }
  return { text: sentence, dropped: false, preview: false, salvaged: '' };
}

/**
 * 剥完之后该落什么。
 *
 * ⚠️ **剥空了 ⇒ 这条不落库**（返回空串）。调用方（`server.mjs`）据此：
 *   ① 不写进 chat.json；② 用同一个 id 广播一条空文本 ⇒ 页面上那个气泡也撤掉。
 *
 * ⚠️ **老口径「剥空 ⇒ 回退原话」是错的**（真机 2026-10-31 实测）：
 *   158 条她的回复里剥皮会整条剥空 **14 条**，回退原话 ⇒ 这 14 条原样落库
 *   ⇒ 老板报的「她在闲聊里真的去调工具翻源码 + 报过程」**根本没修掉**。
 *
 * ⚠️ **例外：屏幕上没有对应气泡的文本 ⇒ 保留原话**（`hasBubble: false`）。
 *   那是指**遗留降级路径**（`question.requested` / `pendingQuestion`）——
 *   那两条路只问「她问了什么」，剥空了老板就只看到一句「我有个问题想问你～」，
 *   **等于把老板的问题吞了** ⇒ 宁可漏这一次，也不吞问题。
 *
 * ⭐ **单独导出来**是为了让自检能**真跑这个判断** —— 写在 `server.mjs` 里的话
 *   自检只能读到源码文本，注入坏法抓不住它。
 *
 * @param {string} original 她原本要说的话（原文）
 * @param {{text:string,removed:boolean}} scrubbed 剥皮结果
 * @param {{hasBubble?:boolean}} [opts] hasBubble=false 表示屏幕上没有这条气泡
 * @returns {string} 该落库的那句话；**空串 = 这条不落库**
 */
export function pickFinalText(original, scrubbed, opts) {
  if (!scrubbed) return String(original ?? '');
  if (!scrubbed.removed) return scrubbed.text;
  if (opts && opts.hasBubble === false) return String(original ?? '');
  return '';
}

/**
 * 剥一条（整条消息）。
 *
 * ⚠️ **整条被剥空时返回空串** —— 调用方（`server.mjs`）要能识别「这条没了」；
 * ⚠️ **空串原样返回**（空消息不是「被剥掉」）；
 * ⚠️ **抢救回来的表情补在末尾** —— 表情落在句尾是规矩第 10 条要求的。
 */
export function scrubText(text) {
  if (!text) return { text: '', removed: false, preview: 0, salvaged: '' };
  const sentences = splitSentences(text);
  if (!sentences.length) {
    return { text: String(text), removed: false, preview: 0, salvaged: '' };
  }
  const kept = [];
  let preview = 0;
  let salvaged = '';
  /** 真的被剥掉了几句 */
  let dropped = 0;
  for (const s of sentences) {
    const r = scrubSentence(s);
    if (r.preview) preview += 1;
    salvaged += r.salvaged;
    if (!r.dropped) kept.push(r.text);
    else dropped += 1;
  }
  let out = kept.join('');
  if (salvaged && !out.includes(salvaged)) {
    out = out + salvaged;
  }
  return {
    text: out,
    // ⚠️ **只有「真的剥掉了什么」才算 removed** —— 标点单独成条（「！」「"」）
    //   不是过程味，是正常聊天 ⇒ 不许被剥掉（宁可漏杀，也不误杀正常话）。
    removed: dropped > 0 && !hasSolidText(out),
    preview,
    salvaged,
  };
}
