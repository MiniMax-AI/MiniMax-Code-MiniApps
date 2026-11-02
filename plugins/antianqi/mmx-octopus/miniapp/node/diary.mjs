// @ts-check

/**
 * 她的日记本（独立于 state.json / chat.json 的第三个文件）。
 *
 * ⭐ **老板 2026-10-29 拍板**：「在后台人物形象的旁边，加一个按钮，进去之后，
 * 是一个日记本，或者是像QQ空间每天发动态的感觉，**每天至少记录一次**，
 * 其他时间也可以写，**但别太频繁**，**每一次字数不要太多**。」
 *
 * ⚠️ **老板 2026-10-29 改口（同一件事上的第二次拍板）**：
 * 「为什么要设置一天只能写三篇，**去掉这个设置**，**撤掉按钮也去掉**，
 * **她写日记我为啥要删除**，下面的**说点什么、让她写、和发表也不要**，
 * 但是**可以添加点赞和评论**。**评论后她可以回复**。」
 *
 * **这一版改了四件事**（其余不动）：
 *  ① **去掉「一天最多 3 篇」的闸门** —— `MAX_PER_DAY` / `canWriteToday()` 都没了。
 *     那个闸门是我把老板原话「但别太频繁」落成的**硬闸**；老板现在自己说不要了。
 *     「每天至少记录一次」**保留**（那是另一条：下限提醒 + 聊天后自动补一篇）。
 *  ② **去掉删除** —— `remove()` / `POST /api/diary/delete` /「撤掉」按钮全没了。
 *     「她写日记我为啥要删除」：日记是她的独白，不是草稿箱。
 *  ③ **去掉用户发动态** —— `POST /api/diary {text}` 与底部输入区
 *     （「说点什么」「让她写」「发表」）都没了。
 *     日记本从「她写 + 用户也能发动态」变成**只读 + 互动**。
 *  ④ **加点赞和评论，评论后她可以回复**（见下面「互动规则」）。
 *
 * **剩下的两条规则**：
 *  ① **每天至少记录一次** —— 下限，不是上限：「今天还没写」的时候界面提醒她该写一篇；
 *     聊天结束后自动补一篇（挂 `runChatTurn()` 落定之后，不挂定时器）。
 *  ② **每一次字数不要太多** —— 一篇最多 `MAX_CHARS` 字，超了**截断**（走 `clip.mjs`）。
 *
 * **互动规则（2026-10-29 追加）**
 *  - **点赞**：`toggleLike()` —— 点一下 +1，再点取消（只有一个用户，0/1 切换）。
 *  - **评论**：`addComment()` —— 用户评论挂在某篇日记下面（最多 `MAX_COMMENTS` 条）。
 *  - **她回复评论**：`setReply()` —— 评论存下后**异步**起一次她的专属会话，
 *    把回复写进那条评论的 `reply` 里。
 *    ⚠️ **回复走串行队列**（一次一个 run）：并发起多个 run 会抢 Agent slot，
 *    而且回复要按评论顺序落，串行才不会乱。
 *
 * **为什么单独一个文件**（跟 `chat.json` 同理）：
 *  - `state.json` 每次 `commit()` 都全量重写 → 日记不该跟着抖；
 *  - `chat.json` 是**对话**，日记是**她的独白** —— 两者角色不同，
 *    混在一起她读自己的日记时会看到用户的原话，串味。
 *
 * **落盘**：走 `atomic-json.mjs` 的唯一实现（临时文件 → fsync → rename）。
 *
 * **日期口径**：`dayKey()` 按**本机本地时间**取 `YYYY-MM-DD`。
 * 「今天」是**她的今天**，不是 UTC 的今天 —— 老板在本地，
 * 晚上 11 点写的日记不能算成第二天。
 *
 * @module miniapp/node/diary
 */

import { writeJsonAtomic } from './atomic-json.mjs';
import { clip } from './clip.mjs';

/** 一篇日记最多几个字（老板：每一次字数不要太多）。 */
export const MAX_CHARS = 120;

/** 一条评论最多几个字（评论比日记短 —— 那是搭话，不是写文章）。 */
export const MAX_COMMENT_CHARS = 60;

/** 最多留多少篇（旧的从头丢 —— 日记本不是无限的，但也不能无限涨）。 */
export const MAX_ENTRIES = 120;

/** 一篇下面最多挂多少条评论（防刷屏）。 */
export const MAX_COMMENTS = 50;

/**
 * 本机本地时区的 `YYYY-MM-DD`。
 *
 * ⚠️ **不用 `toISOString()`** —— 那是 UTC。
 * 本地晚上 8 点 = UTC 中午，同一天会算成两个不同的 dayKey，
 * 「今天写了几篇」的判断就漏了。
 *
 * @param {number} [ms]
 * @returns {string}
 */
export function dayKey(ms = Date.now()) {
  const d = new Date(ms);
  const pad = (n) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * @typedef {{id: string, text: string, at: number, author: 'user'|'her',
 *            reply: {text: string, at: number}|null, replying: boolean}} DiaryComment
 * @typedef {{id: string, day: string, text: string, at: number, author: 'her'|'user',
 *            likes: number, liked: boolean, comments: DiaryComment[]}} DiaryEntry
 */

/**
 * 日记作者。
 *  - `her`  —— **她写的**（她自己的独白；自动写 / 落定后自动补一篇）
 *  - `user` —— 用户发的（2026-10-29 起 UI 上不再提供这个入口，数据结构留着）
 */
export const DIARY_AUTHORS = ['her', 'user'];

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isComment(value) {
  if (!value || typeof value !== 'object') return false;
  const item = /** @type {any} */ (value);
  return typeof item.id === 'string' && typeof item.text === 'string' && typeof item.at === 'number';
}

/**
 * 旧存档（2026-10-29 之前写的日记）没有 likes / comments —— 读回来时补齐。
 *
 * ⚠️ **不能因为字段缺失就整条丢掉** —— 那是老板的日记，丢不得。
 *
 * @param {any} value
 * @returns {DiaryEntry|null}
 */
function normalizeEntry(value) {
  if (!value || typeof value !== 'object') return null;
  const item = /** @type {any} */ (value);
  if (typeof item.id !== 'string' || typeof item.day !== 'string') return null;
  if (typeof item.text !== 'string' || typeof item.at !== 'number') return null;
  const author = item.author === 'user' ? 'user' : 'her';
  const comments = Array.isArray(item.comments)
    ? item.comments.filter(isComment).map((c) => ({
        id: c.id,
        text: c.text,
        at: c.at,
        author: c.author === 'her' ? 'her' : 'user',
        reply:
          c.reply && typeof c.reply.text === 'string' && typeof c.reply.at === 'number'
            ? { text: c.reply.text, at: c.reply.at }
            : null,
        replying: c.replying === true,
      }))
    : [];
  return {
    id: item.id,
    day: item.day,
    text: item.text,
    at: item.at,
    author,
    likes: Number.isFinite(item.likes) ? Math.max(0, Math.trunc(item.likes)) : 0,
    liked: item.liked === true,
    comments,
  };
}

/**
 * 从消息 id 里取序号（d-12 → 12）。重启后接着发号。
 * @param {string} id
 * @returns {number}
 */
function idSeq(id) {
  const matched = /-(\d+)$/.exec(String(id ?? ''));
  return matched ? Number(matched[1]) : 0;
}

export class DiaryStore {
  /**
   * @param {string} dataDir Host 注入的运行期数据目录
   */
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = `${dataDir}/diary.json`;
    /** @type {DiaryEntry[]} */
    this.entries = [];
    /** @type {number} 发号器：只增不减，重启后由文件里的最大 id 接着发 */
    this.seq = 0;
    /** @type {number} 评论发号器（跟日记 id 不是一个池子） */
    this.commentSeq = 0;
    /** @type {Promise<any>} 串行化写盘 */
    this.chain = Promise.resolve();
  }

  /**
   * 读回上次的日记。首次运行没有存档，用空本子。
   * @returns {Promise<void>}
   */
  async load() {
    try {
      const { readFile } = await import('node:fs/promises');
      const raw = await readFile(this.file, 'utf8');
      const saved = JSON.parse(raw);
      if (saved && typeof saved === 'object' && Array.isArray(saved.entries)) {
        this.entries = saved.entries.map(normalizeEntry).filter(Boolean).slice(-MAX_ENTRIES);
        this.seq = this.entries.reduce((max, item) => Math.max(max, idSeq(item.id)), 0);
        this.commentSeq = this.entries.reduce(
          (max, item) =>
            item.comments.reduce((m, c) => Math.max(m, idSeq(c.id)), max),
          0
        );
      }
    } catch {
      // 首次运行没有存档，用空本子。
    }
  }

  /**
   * 原子写盘。**唯一的 JSON 落盘实现**在 `atomic-json.mjs`。
   * @returns {Promise<void>}
   */
  async persist() {
    try {
      await writeJsonAtomic(this.file, { entries: this.entries });
    } catch {
      // 存档失败不影响运行。
    }
  }

  /**
   * 全部日记（新的在后）。
   * @returns {DiaryEntry[]}
   */
  list() {
    return this.entries.slice();
  }

  /**
   * 找一篇。
   * @param {string} id
   * @returns {DiaryEntry|null}
   */
  find(id) {
    const target = String(id ?? '');
    return this.entries.find((item) => item.id === target) ?? null;
  }

  /**
   * 今天的日记。
   * @param {number} [ms]
   * @returns {DiaryEntry[]}
   */
  today(ms = Date.now()) {
    const key = dayKey(ms);
    return this.entries.filter((item) => item.day === key);
  }

  /**
   * 今天写了几篇。
   * @param {number} [ms]
   * @returns {number}
   */
  countToday(ms = Date.now()) {
    return this.today(ms).length;
  }

  /**
   * **今天还没写**（老板说「每天至少记录一次」—— 这是提醒的依据）。
   * @param {number} [ms]
   * @returns {boolean}
   */
  voidToday(ms = Date.now()) {
    return this.countToday(ms) === 0;
  }

  /**
   * 写一篇。超字数**截断**（跟气泡同一口径）。
   *
   * ⚠️ **不再有「一天最多 N 篇」的闸门**（老板 2026-10-29 明确要求去掉）。
   *
   * @param {string} text 正文
   * @param {{now?: number, author?: 'her'|'user'}} [options]
   * @returns {Promise<DiaryEntry>} 写入的条目
   */
  async write(text, options = {}) {
    const now = options.now ?? Date.now();
    const author = options.author === 'user' ? 'user' : 'her';
    const clean = clip(text, MAX_CHARS);
    if (!clean) throw new Error('EMPTY_TEXT');
    const next = this.chain.then(() => this.writeEntry(clean, now, author));
    this.chain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  /**
   * @param {string} text
   * @param {number} now
   * @param {'her'|'user'} author
   * @returns {Promise<DiaryEntry>}
   */
  async writeEntry(text, now, author) {
    this.seq += 1;
    const entry = {
      id: `d-${this.seq}`,
      day: dayKey(now),
      text,
      at: now,
      author,
      likes: 0,
      liked: false,
      comments: [],
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries = this.entries.slice(-MAX_ENTRIES);
    await this.persist();
    return entry;
  }

  /**
   * **点赞 / 取消点赞**（切换）。
   *
   * 只有一个用户，所以是 0/1 切换：点一下 +1，再点取消。
   *
   * @param {string} id 日记 id
   * @returns {Promise<DiaryEntry|null>} 改完的条目（找不到就是 null）
   */
  async toggleLike(id) {
    const entry = this.find(id);
    if (!entry) return null;
    entry.liked = !entry.liked;
    entry.likes = Math.max(0, entry.likes + (entry.liked ? 1 : -1));
    await this.persist();
    return entry;
  }

  /**
   * 加一条评论（用户发的）。
   *
   * @param {string} id 日记 id
   * @param {string} text 评论正文
   * @param {{now?: number}} [options]
   * @returns {Promise<{entry: DiaryEntry, comment: DiaryComment}|null>}
   */
  async addComment(id, text, options = {}) {
    const now = options.now ?? Date.now();
    const entry = this.find(id);
    if (!entry) return null;
    const clean = clip(text, MAX_COMMENT_CHARS);
    if (!clean) throw new Error('EMPTY_TEXT');
    this.commentSeq += 1;
    const comment = {
      id: `c-${this.commentSeq}`,
      text: clean,
      at: now,
      author: 'user',
      reply: null,
      replying: true,
    };
    entry.comments.push(comment);
    if (entry.comments.length > MAX_COMMENTS) {
      entry.comments = entry.comments.slice(-MAX_COMMENTS);
    }
    await this.persist();
    return { entry, comment };
  }

  /**
   * 把她的回复写进某条评论。
   *
   * @param {string} entryId 日记 id
   * @param {string} commentId 评论 id
   * @param {string} text 回复正文
   * @param {{now?: number}} [options]
   * @returns {Promise<DiaryComment|null>}
   */
  async setReply(entryId, commentId, text, options = {}) {
    const now = options.now ?? Date.now();
    const entry = this.find(entryId);
    if (!entry) return null;
    const comment = entry.comments.find((item) => item.id === String(commentId ?? ''));
    if (!comment) return null;
    const clean = clip(text, MAX_CHARS);
    if (!clean) throw new Error('EMPTY_TEXT');
    comment.reply = { text: clean, at: now };
    comment.replying = false;
    await this.persist();
    return comment;
  }

  /**
   * 评论没写出来的时候把「正在回复」标记撤掉（别让界面一直转圈）。
   *
   * @param {string} entryId
   * @param {string} commentId
   * @returns {Promise<void>}
   */
  async clearReplying(entryId, commentId) {
    const entry = this.find(entryId);
    if (!entry) return;
    const comment = entry.comments.find((item) => item.id === String(commentId ?? ''));
    if (!comment) return;
    comment.replying = false;
    await this.persist();
  }
}

/**
 * 给界面用的**日报状态**（一次说清「今天写了没 / 每篇多少字」）。
 *
 * ⚠️ **没有 `maxPerDay` / `canWrite`** —— 天上限闸门已经拿掉了（老板 2026-10-29）。
 *
 * @param {DiaryStore} store
 * @param {number} [now]
 * @returns {{countToday: number, maxChars: number, maxCommentChars: number, void: boolean, day: string}}
 */
export function diaryStatus(store, now = Date.now()) {
  const countToday = store.countToday(now);
  return {
    countToday,
    maxChars: MAX_CHARS,
    maxCommentChars: MAX_COMMENT_CHARS,
    void: countToday === 0,
    day: dayKey(now),
  };
}
