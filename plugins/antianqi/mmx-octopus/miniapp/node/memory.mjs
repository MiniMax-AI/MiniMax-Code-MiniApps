// @ts-check

/**
 * 日记记忆层 —— 把她的日记从「给你看的记录」变成「她真的记得的东西」。
 *
 * ⭐ **老板 2026-10-29 拍板**：「日记是很重要的记录，就相当于每天整理的 memory 或者重点。」
 *
 * 拍板前日记是**只写不读**的：`DiaryStore.list()` 从来没进过任何 prompt ——
 * 她写，你看，点赞评论，**她自己看不见**。2026-10-29 真机实证：
 * 她那篇日记开头写的是「下午老板又让我写日记」——
 * 她读的是 `AGENTS.md`（身份层），**不是自己的日记**，也不知道自己写过。
 *
 * 这一轮接通三件事：
 *  ① **每轮**自动注入「最近几篇 + 按你这句问话命中的旧日记」（`pickDiaryMemory`）；
 *  ② **写日记时**带上她最近写过的（`buildRecentDiaryContext`）；
 *  ③ 活人感第 14、15 条放行 —— 当年因为「记忆档案没有」故意留空的，
 *     现在日记就是那份凭据（见 `PROPOSAL-reply-alive-rules.md` 的 14/15 条原稿）。
 *
 * **为什么不用 BM25 / 向量库**：
 * 日记上限 `MAX_ENTRIES` 120 篇 × 每篇 120 字 = 最多 14400 字 ——
 * 全量扫一遍成本可以忽略。引第三方召回是过度工程：多一套依赖、多一份口径，
 * 而真正难的不是「算相似」，是**别把泛词当命中**（见 `STOP_FRAGMENTS`）。
 *
 * ⚠️ **注入是有成本的**：这段文本是作为 `user` 消息发出去的 → **它会留在会话历史里**，
 * 每一轮都重贴会撑爆上下文（`chatinput.mjs` 记着同一个教训：身份层每轮重贴
 * 实测第 2 轮就 3 万+ tokens）。所以这里的条数和字数都压得很低：
 * **最近 2 篇 + 命中 2 篇 + 正文 400 字上限**，典型一轮 ~300 tokens。
 *
 * **单一真源**：带哪几篇、命中怎么算、注入长什么样，全在这个文件里。
 * `server.mjs` 只调它，不另写一份 —— 同一判断写两处就会漂。
 *
 * @module miniapp/node/memory
 */

import { clip, textLength } from './clip.mjs';

/** 一轮最多带几篇「最近的」日记。 */
export const MEMORY_RECENT_LIMIT = 2;

/** 一轮最多带几篇「按这句话命中」的旧日记。 */
export const MEMORY_HIT_LIMIT = 2;

/** 注入正文最多几个字（超了从最早的一篇开始丢）。 */
export const MEMORY_MAX_CHARS = 400;

/** 写日记时带上最近几篇。 */
export const MEMORY_WRITE_RECENT_LIMIT = 3;

/**
 * **停用片段** —— 命中了也不算「相关」。
 *
 * 中文没有空格，2 字片段极易撞车：「老板」「今天」「事情」这种词
 * 在每一篇日记里都出现 → 一旦拿来算命中，**每一篇都会被拖进来**，
 * 她每轮收到一堆无关日记，只会更吵。
 *
 * ⚠️ **只放 2 字以上的片段** —— 单字（尤其「就」「的」「我」）会误杀整片正文。
 * ⚠️ **判据是「包含」不是「等于」**：3 字片段「老板说过」含「老板」→ 丢掉。
 *
 * @type {readonly string[]}
 */
export const STOP_FRAGMENTS = [
  '什么', '一个', '我们', '你们', '他们', '可以', '这样', '没有', '不是',
  '就是', '还是', '一下', '现在', '已经', '然后', '所以', '因为', '但是',
  '要是', '怎么', '这个', '那个', '有点', '有些', '自己', '的话', '真的',
  '东西', '事情', '老板', '今天', '明天', '昨天', '觉得', '知道', '应该',
  '可能', '好像', '开始', '需要', '感觉', '一直', '时候', '出来', '进去',
  '这么', '那么', '一点', '而且', '不过', '只是', '而是', '如果', '这些',
  '那些', '我是', '你是', '他是', '别的', '一样', '起来', '下来', '过去',
  '在吗',
];

/**
 * 取正文里的 n-gram 集合（去标点空白，丢掉含停用片段的）。
 *
 * ⚠️ **导出来是为了让自检能直接判它** —— 只判「停用片段表非空」的话，
 * 把过滤那行删掉（表还在、还是非空）照样全绿 —— 判据要能被抓。
 *
 * @param {unknown} text
 * @param {number} size 窗口大小（2 或 3）
 * @returns {Set<string>}
 */
export function contentGrams(text, size) {
  const clean = String(text ?? '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
  const out = new Set();
  for (let i = 0; i + size <= clean.length; i += 1) {
    const g = clean.slice(i, i + size);
    if (STOP_FRAGMENTS.some((frag) => g.includes(frag))) continue;
    out.add(g);
  }
  return out;
}

/** 内部别名（保持下面几处读起来短）。 */
const grams = contentGrams;

/**
 * @typedef {{strong: number, weak: number, coverage: number, value: number, hit: boolean}} MatchScore
 * @typedef {{id: string, day: string, text: string, why: 'recent'|'hit', score: number}} MemoryPick
 */

/**
 * 这一句跟一篇日记有多相关。
 *
 * **强信号**：3 字片段整段命中（「齐大店」）—— 命中一个就算。
 * **弱信号**：2 字片段命中 —— 还要**覆盖率 ≥ 0.4**。
 *
 * 为什么要覆盖率：查询越长，2 字片段撞上的概率越高（长句里必然有几对相邻字
 * 在日记里也出现过）。只看命中数会误召回；只看命中率会把长查询判死。
 * 覆盖率是**按查询长度自适应**的：
 *  - 短查询（「写日记」，2 个片段）→ 命中 1 个就是 0.5，覆盖率够 → 命中 ✓
 *  - 长查询（30 个片段）→ 要命中 12 个才够 → 不会误召回 ✓
 *
 * ⚠️ **覆盖率 ≥ 0.4 而不是 0.3**：0.3 的话 3 个片段的查询命中 1 个就够了，
 * 那是泛词误召回的高发区（实测「今天天气不错」会蹭到只写了「不错」的日记）。
 *
 * @param {unknown} query 用户这一轮说的话
 * @param {unknown} entryText 日记正文
 * @returns {MatchScore}
 */
export function scoreDiaryEntry(query, entryText) {
  const q2 = grams(query, 2);
  const q3 = grams(query, 3);
  if (!q2.size) return { strong: 0, weak: 0, coverage: 0, value: 0, hit: false };
  const e2 = grams(entryText, 2);
  const e3 = grams(entryText, 3);
  let strong = 0;
  for (const g of q3) if (e3.has(g)) strong += 1;
  let weak = 0;
  for (const g of q2) if (e2.has(g)) weak += 1;
  const coverage = weak / q2.size;
  const hit = strong >= 1 || (weak >= 1 && coverage >= 0.4);
  return { strong, weak, coverage, value: strong * 3 + weak, hit };
}

/**
 * `YYYY-MM-DD` → `10月29日`（人话）。认不出就原样返回。
 *
 * @param {unknown} day
 * @returns {string}
 */
export function formatDay(day) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day ?? ''));
  if (!matched) return String(day ?? '');
  return `${Number(matched[2])}月${Number(matched[3])}日`;
}

/**
 * 挑出**能当她自己的日记**的条目。
 *
 * ⚠️ **只取 `author === 'her'`** —— 数据结构里留着 `author: 'user'`
 * （2026-10-29 之后 UI 不再提供用户发动态的入口，但存档里可能有旧条目）。
 * 那些是**用户写的**，塞进「你的日记」里 = 让她以为那是自己写的。
 *
 * @param {unknown} entries
 * @returns {any[]}
 */
function usableEntries(entries) {
  return (Array.isArray(entries) ? entries : []).filter(
    (item) =>
      item &&
      typeof item.text === 'string' &&
      item.text.trim() &&
      item.author !== 'user'
  );
}

/**
 * 按字数预算**丢掉最早的几篇**，留下真正塞得进去的。
 *
 * ⚠️ **丢的是最早的，留的是最近的** —— 她现在最可能用到的是最近的。
 * 命中命中的旧日记排在前面，但它是**这一轮问话**带出来的，
 * 优先级跟「最近」一样高，所以统一按时间正序丢最老的。
 *
 * @param {readonly MemoryPick[]} picked
 * @param {number} [maxChars]
 * @returns {MemoryPick[]} 实际带上的那些
 */
export function fitMemoryPicks(picked, maxChars = MEMORY_MAX_CHARS) {
  const list = Array.isArray(picked) ? picked.slice() : [];
  while (list.length > 1) {
    const body = list.map((item) => `· ${formatDay(item.day)}：${item.text}`).join('\n');
    if (textLength(body) <= maxChars) break;
    list.shift();
  }
  return list;
}

/**
 * 拼注入正文。
 *
 * ⚠️ **`maxChars` 只管正文**（不含抬头）—— 抬头是固定开销，不参与预算。
 *
 * @param {readonly MemoryPick[]} picked
 * @param {number} [maxChars]
 * @returns {string}
 */
export function buildMemoryBlock(picked, maxChars = MEMORY_MAX_CHARS) {
  const list = fitMemoryPicks(picked, maxChars);
  if (!list.length) return '';
  const lines = list.map((item) => `· ${formatDay(item.day)}：${item.text}`);
  let body = lines.join('\n');
  // 只剩一篇还超（单篇就超预算）→ 截这一篇，不丢整篇。
  if (textLength(body) > maxChars) body = clip(body, maxChars);
  return (
    '[你的日记]\n' +
    '（背景，不用重复回答；要提起来的时候，把日记里的原话引出来）\n' +
    body
  );
}

/**
 * 挑这一轮要带哪些日记。
 *
 * 顺序：
 *  ① **最近几篇** —— 兜底，她至少知道自己最近写过什么。
 *  ② **按这句话命中的旧日记** —— 最近的已经带上了，不重复。
 *
 * 挑完按**时间正序**（早的在前）—— 她看到的是一条时间线，不是一堆碎片。
 *
 * @param {readonly any[]} entries 日记条目（新的在后）
 * @param {{text?: string, recentLimit?: number, hitLimit?: number, maxChars?: number}} [options]
 * @returns {{block: string, picked: MemoryPick[]}}
 */
export function pickDiaryMemory(entries, options = {}) {
  const {
    text = '',
    recentLimit = MEMORY_RECENT_LIMIT,
    hitLimit = MEMORY_HIT_LIMIT,
    maxChars = MEMORY_MAX_CHARS,
  } = options;
  const list = usableEntries(entries);
  if (!list.length) return { block: '', picked: [] };

  const recent = list.slice(-Math.max(0, recentLimit));
  const recentIds = new Set(recent.map((item) => String(item.id ?? '')));

  const scored = list
    .filter((item) => !recentIds.has(String(item.id ?? '')))
    .map((entry) => ({ entry, score: scoreDiaryEntry(text, entry.text) }))
    .filter((row) => row.score.hit)
    .sort(
      (a, b) => b.score.value - a.score.value || Number(a.entry.at ?? 0) - Number(b.entry.at ?? 0)
    )
    .slice(0, Math.max(0, hitLimit));

  /** @type {MemoryPick[]} */
  const picked = [
    ...recent.map((entry) => ({
      id: String(entry.id ?? ''),
      day: String(entry.day ?? ''),
      text: String(entry.text ?? ''),
      why: 'recent',
      score: 0,
    })),
    ...scored.map((row) => ({
      id: String(row.entry.id ?? ''),
      day: String(row.entry.day ?? ''),
      text: String(row.entry.text ?? ''),
      why: 'hit',
      score: row.score.value,
    })),
  ];

  picked.sort((a, b) => (a.day === b.day ? 0 : a.day < b.day ? -1 : 1));

  // ⚠️ **先按预算裁，再拼正文** —— 这样 `picked` 报的就是**真正带进去的**那些，
  // 不会「报了 4 篇、正文里只有 2 篇」（自检要卡这个一致性）。
  const kept = fitMemoryPicks(picked, maxChars);
  return { block: buildMemoryBlock(kept, maxChars), picked: kept };
}

/**
 * 写日记时带上她最近写过的。
 *
 * **为什么**：她原来写的时候眼前是空的 —— 所以会说「又让我写日记」，
 * 也会把同一件事写两遍（2026-10-29 真机实证）。
 *
 * @param {readonly any[]} entries 日记条目（新的在后）
 * @param {{limit?: number}} [options]
 * @returns {string} 空串 = 她还没写过（那就别塞空段）
 */
export function buildRecentDiaryContext(entries, options = {}) {
  const limit = Math.max(0, options.limit ?? MEMORY_WRITE_RECENT_LIMIT);
  const recent = usableEntries(entries).slice(-limit);
  if (!recent.length) return '';
  const lines = recent.map((item) => `· ${formatDay(item.day)}：${item.text}`);
  return '（下面是你最近写过的日记，别重复写同一件事）\n' + lines.join('\n');
}
