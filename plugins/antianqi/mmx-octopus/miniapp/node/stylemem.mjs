// @ts-check

/**
 * **她从相处中学到的说话习惯** —— 结构照 `learn_style`（MaiBot），
 * 内容全部自己写。
 *
 * ⚠️ **为什么要有这一层**（老板 2026-10-30 第二十六轮第三档第二项）：
 *
 * 规矩能规定「一句话该多短」，但**规定不了一个人的说话节奏** ——
 * 句尾带不带标点、爱不爱用叠词、打字快的时候怎么断句，
 * 这些是**相处出来的**，不是写下来的。
 *
 * 第二十五轮已经把「打字习惯」写进了规矩（**正例 + 密度下限**），
 * 但那是**我们替她规定**的习惯 —— 她还在机械执行。
 * 这一层是**让她自己从老板身上看出来**。
 *
 * ## 产出结构（借鉴 MaiBot 的 `learn_style`，**只借结构不抄内容**）
 *
 * 每条 = `{situation, style, id}`：
 * - `situation`：**场景**（≤20 字）—— 什么时候会这样
 * - `style`：**表达方式**（≤20 字）—— 那时候怎么说
 * - `id`：**来源编号** —— 指向聊天记录里的哪几条（可溯源）
 *
 * 「当 AAAAA 时，可以 BBBBB」—— 场景绑表达，不是无脑复读。
 *
 * ## ⚠️ 三条排除规则（写进提示词，服务端再做一遍能做的硬过滤）
 *
 * 1. **不学表情包和图片** —— 只学文字；
 * 2. **不学她自己（her）的发言** —— 输入里只给老板的话，服务端也再挡一道；
 * 3. **不涉及具体的人名和具体名词** —— 事情、行业、产品名都不写进去
 *    （这样学到的规律**可迁移**，不是「张三喜欢说」）。
 *
 * ⚠️ 第 3 条**无法在服务端精确判**（专名识别不可靠）⇒
 * 它是**提示词侧的约束**；服务端做能做的那部分（长度 / 格式 / 去重 / 条数 /
 * 含数字英文路径）。
 *
 * ⚠️ **别让她变成老板的复读机**：每条必须**绑场景**，
 * 注入时写成「在某种场景下你可以这样讲」，不是「你要学老板说话」。
 */

import { writeJsonAtomic } from './atomic-json.mjs';
import { clip } from './clip.mjs';

/** 默认口径。 */
export const STYLE_DEFAULTS = {
  /** 最多留几条。 */
  max: 5,
  /** 至少几条才值得注入（不够就当没学到）。 */
  min: 1,
  /** 每条 situation / style 的字数上限。 */
  maxChars: 20,
  /** 一次回顾看多少条老板的消息（最近的）。 */
  window: 40,
  /** 一条消息至少这么长才值得学（太短的是「嗯」「好」）。 */
  minSourceChars: 4,
};

/** 服务端硬过滤：含这些的东西一律拒（具体名词的高发区）。 */
export const STYLE_REJECT_PATTERNS = [
  /[0-9０-９]/,      // 数字
  /[A-Za-z]{2,}/,    // 英文词
  /https?:\/\//i,   // 网址
  /[\\/]/,           // 路径
];

/**
 * 从聊天记录里挑出**老板说的话**（带来源编号）。
 *
 * ⚠️ **只取 user 那一侧** —— 排除规则第 2 条（不学自己的发言）
 * 在**输入层**就挡住，比在提示词里叮嘱可靠。
 *
 * @param {{role?: string, text?: string, at?: number}[]} messages
 * @param {{window?: number, minSourceChars?: number}} [options]
 * @returns {{id: string, text: string}[]}
 */
export function pickSourceLines(messages, options = {}) {
  const cfg = { ...STYLE_DEFAULTS, ...options };
  const list = Array.isArray(messages) ? messages : [];
  const picked = [];
  for (const m of list) {
    if (!m || String(m.role ?? '') !== 'user') continue;
    const text = String(m.text ?? '').trim();
    if (text.length < cfg.minSourceChars) continue;
    picked.push({ id: String(picked.length + 1), text });
  }
  return picked.slice(-cfg.window);
}

/**
 * 造回顾的提示词。
 *
 * ⚠️ **只给老板说的话**，并且明确「这是老板的话」，
 * 免得模型把「我」当成自己。
 *
 * @param {{id: string, text: string}[]} lines
 * @returns {string}
 */
export function buildStylePrompt(lines, options = {}) {
  const cfg = { ...STYLE_DEFAULTS, ...options };
  const body = (Array.isArray(lines) ? lines : [])
    .map((l) => `[${l.id}] ${l.text}`)
    .join('\n');
  return [
    '【学说话习惯】下面是老板这段时间说过的话。请从中提取**老板的表达方式和句式**。',
    '1. 只看文字，不要考虑表情包和图片',
    '2. 只看老板说的话，不要总结你自己说的话',
    '3. 不要涉及具体的人名，也不要涉及具体名词（事情、行业、产品名都不要写进去）',
    '4. 不要学老板的称呼和身份，只学他说话的**样子**',
    '5. 想想有没有特殊的说法或口头禅，一并总结成语言风格',
    '6. 例子仅供参考，请严格根据上面老板说的话总结',
    '',
    body || '（老板还没说过什么话）',
    '',
    '请总结成如下格式的规律：当 "AAAAA" 时，可以 "BBBBB"。',
    '- AAAAA 表示某个场景，不超过 20 个字',
    '- BBBBB 表示对应的语言风格、句式或表达方式，不超过 20 个字',
    '- 表达方式在 3-5 个左右，不要超过 10 个',
    '',
    '输出要求：',
    '请仅输出 JSON 数组，不要输出重复内容。每个元素为一个对象，字段名如下：',
    '[',
    '  {"situation": "某个场景", "style": "对应的说法或句式", "id": "来源编号"},',
    ']',
    '',
    '字段说明：',
    '- situation：表示「在什么情境下」的简短概括（不超过 20 个字）',
    '- style：表示对应的语言风格或常用表达（不超过 20 个字）',
    '- id：该表达方式对应的来源编号，即上面聊天记录里的 id 数字，请只输出数字本身',
    '',
    '输出 JSON：',
  ].join('\n');
}

/**
 * **解析并硬过滤**模型产出的 JSON。
 *
 * ⚠️ **解析失败不抛异常** —— 返回空结果，让调用方安静跳过
 * （回顾失败不该影响聊天）。
 *
 * @param {string} raw
 * @param {{max?: number, maxChars?: number}} [options]
 * @returns {{items: {situation: string, style: string, id: string}[], rejected: string[]}}
 */
export function parseStyleOutput(raw, options = {}) {
  const cfg = { ...STYLE_DEFAULTS, ...options };
  const items = [];
  const rejected = [];
  const text = String(raw ?? '').trim();
  if (!text) return { items, rejected: ['空输出'] };

  // 模型有时会包一层 ```json —— 抠出第一对方括号
  const lb = text.indexOf('[');
  const rb = text.lastIndexOf(']');
  if (lb < 0 || rb <= lb) return { items, rejected: ['不是 JSON 数组'] };
  let arr;
  try {
    arr = JSON.parse(text.slice(lb, rb + 1));
  } catch {
    return { items, rejected: ['JSON 解析失败'] };
  }
  if (!Array.isArray(arr)) return { items, rejected: ['不是数组'] };

  const seen = new Set();
  for (const row of arr) {
    if (items.length >= cfg.max) break;
    if (!row || typeof row !== 'object') {
      rejected.push('不是对象');
      continue;
    }
    const situation = String(row.situation ?? '').trim();
    const style = String(row.style ?? '').trim();
    const id = String(row.id ?? '').trim();
    if (!situation || !style) {
      rejected.push('字段缺失');
      continue;
    }
    if (situation.length > cfg.maxChars || style.length > cfg.maxChars) {
      rejected.push('太长');
      continue;
    }
    let bad = false;
    for (const re of STYLE_REJECT_PATTERNS) {
      if (re.test(situation) || re.test(style)) {
        bad = true;
        break;
      }
    }
    if (bad) {
      rejected.push('含具体名词');
      continue;
    }
    const key = `${situation}|${style}`;
    if (seen.has(key)) {
      rejected.push('重复');
      continue;
    }
    seen.add(key);
    items.push({ situation, style, id: /^\d+$/.test(id) ? id : '' });
  }
  return { items, rejected };
}

/**
 * 拼成注入她的那一段。
 *
 * ⚠️ **措辞很关键** —— 不能让模型觉得「我要模仿老板」。
 * 写成「你从老板身上看出来的一点」，并且**每条都绑着场景**。
 *
 * @param {{situation: string, style: string, id: string}[]} items
 * @returns {string} 空串 = 没有可注入的
 */
export function formatStyleBlock(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return '';
  const lines = list.map(
    (it) => `· 碰到「${it.situation}」这种时候，你可以用「${it.style}」这种说法。`
  );
  return ['[你从老板身上看出来的一点说话习惯]', ...lines].join('\n');
}

/**
 * 存储 —— 学到的习惯要**落盘**（跨会话还在）。
 *
 * ⚠️ 落盘用 `atomic-json.mjs`（唯一的 JSON 落盘实现）。
 */
export class StyleMemStore {
  /**
   * @param {string} dataDir Host 注入的运行期数据目录
   */
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = `${dataDir}/style.json`;
    /** @type {{situation: string, style: string, id: string}[]} */
    this.items = [];
    /** @type {number} 上次回顾的时间戳（0 = 从没回顾过） */
    this.lastAt = 0;
    /** @type {Promise<any>} 串行化写盘 */
    this.chain = Promise.resolve();
  }

  /**
   * 读回上次学到的。
   * @returns {Promise<void>}
   */
  async load() {
    try {
      const { readFile } = await import('node:fs/promises');
      const raw = await readFile(this.file, 'utf8');
      const saved = JSON.parse(raw);
      if (saved && typeof saved === 'object') {
        if (Array.isArray(saved.items)) {
          this.items = saved.items
            .map((row) => ({
              situation: String(row?.situation ?? '').trim(),
              style: String(row?.style ?? '').trim(),
              id: String(row?.id ?? '').trim(),
            }))
            .filter((row) => row.situation && row.style)
            .slice(-STYLE_DEFAULTS.max);
        }
        this.lastAt = Number(saved.lastAt) || 0;
      }
    } catch {
      // 首次运行没有存档，用空本子。
    }
  }

  /**
   * 原子写盘。
   * @returns {Promise<void>}
   */
  async persist() {
    try {
      await writeJsonAtomic(this.file, { items: this.items, lastAt: this.lastAt });
    } catch {
      // 存档失败不影响运行。
    }
  }

  /**
   * 当前学到的（新的在后）。
   * @returns {{situation: string, style: string, id: string}[]}
   */
  list() {
    return this.items.slice();
  }

  /**
   * 整批换掉。
   * @param {{situation: string, style: string, id: string}[]} items
   * @returns {Promise<void>}
   */
  async replace(items) {
    this.items = (Array.isArray(items) ? items : []).slice(-STYLE_DEFAULTS.max);
    this.lastAt = Date.now();
    await this.persist();
  }

  /**
   * 今天还没回顾过吗？（跟日记的 `voidToday()` 同一路数）
   * @param {number} [now]
   * @returns {boolean}
   */
  voidToday(now = Date.now()) {
    if (!this.lastAt) return true;
    const d = new Date(now);
    const last = new Date(this.lastAt);
    return d.getFullYear() !== last.getFullYear()
      || d.getMonth() !== last.getMonth()
      || d.getDate() !== last.getDate();
  }
}

/**
 * 注入块（给 `buildChatInput` 用）。
 *
 * ⚠️ **条数不够就不注入** —— 学到一两条半成品不如不学。
 *
 * @param {StyleMemStore} store
 * @param {{min?: number}} [options]
 * @returns {string}
 */
export function buildStyleBlock(store, options = {}) {
  const cfg = { ...STYLE_DEFAULTS, ...options };
  const items = store && typeof store.list === 'function' ? store.list() : [];
  if (items.length < cfg.min) return '';
  return clip(formatStyleBlock(items), 600);
}
