// @ts-check

/**
 * 聊天历史存储（独立于 state.json）。
 *
 * 契约 v3 §2.2：
 *  - 文件落在 context.dataDir/chat.json
 *  - 结构 { messages: [{ id, role, text, at }] }
 *  - role 只有 user / her 两种（通知走气泡，不进聊天区）
 *  - 只保留最近 200 条，超了从头丢
 *  - 只在消息落定时写盘；text.delta 不落盘（否则每次流式片段都全量重写文件）
 *  - 写入是原子的：走 `atomic-json.mjs` 的唯一实现（临时文件 + rename）
 *
 * 为什么独立于 state.json：state.json 每次 commit() 都全量重写，聊天历史不该跟着抖。
 */

import { writeJsonAtomic } from './atomic-json.mjs';

/** 聊天历史最多留 200 条，超了从头丢。 */
const MAX_MESSAGES = 200;

/**
 * 消息角色：**只有用户说的和她说的两种**。
 *
 * 聊天区只放对话（2026-10-28 老板拍板：「通知类走气泡，聊天就是对话，
 * 不要通知插进来」）。通知一律走气泡通道，不进 chat.json。
 *
 * 把角色集合收窄到两种，是那道规矩的**结构性保证** ——
 * 再往前写一条 role:'system' 会直接抛 INVALID_ROLE，
 * 而不是靠「大家记得别这么写」来维持。
 */
export const CHAT_ROLES = ['user', 'her'];

/**
 * @typedef {{id: string, role: 'user'|'her', text: string, at: number}} ChatMessage
 */

/**
 * 从消息 id 里取序号（m-12 → 12）。用来在重启后接着发号。
 * @param {string} id
 * @returns {number}
 */
function idSeq(id) {
  const matched = /-(\d+)$/.exec(String(id ?? ''));
  return matched ? Number(matched[1]) : 0;
}

/**
 * @param {unknown} value
 * @returns {value is ChatMessage}
 */
function isChatMessage(value) {
  if (!value || typeof value !== 'object') return false;
  const item = /** @type {any} */ (value);
  return (
    typeof item.id === 'string' &&
    typeof item.text === 'string' &&
    typeof item.at === 'number' &&
    CHAT_ROLES.includes(item.role)
  );
}

export class ChatStore {
  /**
   * @param {string} dataDir Host 注入的运行期数据目录
   */
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = `${dataDir}/chat.json`;
    /** @type {ChatMessage[]} */
    this.messages = [];
    /** @type {number} 发号器：只增不减，重启后由文件里的最大 id 接着发 */
    this.seq = 0;
    /** @type {Promise<any>} 串行化写盘，避免并发 append 互相踩 */
    this.chain = Promise.resolve();
  }

  /**
   * 读回上次的历史。首次运行没有存档，用空历史。
   * @returns {Promise<void>}
   */
  async load() {
    try {
      const { readFile } = await import('node:fs/promises');
      const raw = await readFile(this.file, 'utf8');
      const saved = JSON.parse(raw);
      if (saved && typeof saved === 'object' && Array.isArray(saved.messages)) {
        this.messages = saved.messages.filter(isChatMessage).slice(-MAX_MESSAGES);
        this.seq = this.messages.reduce((max, item) => Math.max(max, idSeq(item.id)), 0);
      }
    } catch {
      // 首次运行没有存档，用空历史。
    }
  }

  /**
   * 原子写盘。**唯一的 JSON 落盘实现**在 `atomic-json.mjs`
   * （临时文件 + 独占创建 + fsync + rename）——不在这儿另写一份。
   * @returns {Promise<void>}
   */
  async persist() {
    try {
      await writeJsonAtomic(this.file, { messages: this.messages });
    } catch {
      // 存档失败不影响运行。
    }
  }

  /**
   * 全量历史（副本，外部改不动内部数组）。
   * @returns {ChatMessage[]}
   */
  list() {
    return this.messages.slice();
  }

  /**
   * 预分配一个消息 id。流式增量帧要用同一个 id 指向最终落定的那条消息，
   * 所以发号和落盘要分开。
   * @returns {string}
   */
  nextId() {
    this.seq += 1;
    return `m-${this.seq}`;
  }

  /**
   * 追加一条消息并落盘。串行执行，避免并发写互相覆盖。
   * @param {'user'|'her'} role
   * @param {string} text
   * @param {string} [id] 指定 id（一般是提前发好的那个）
   * @returns {Promise<ChatMessage>}
   */
  appendMessage(role, text, id) {
    const next = this.chain.then(() => this.writeMessage(role, text, id));
    this.chain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  /**
   * @param {'user'|'her'} role
   * @param {string} text
   * @param {string} [id]
   * @returns {Promise<ChatMessage>}
   */
  async writeMessage(role, text, id) {
    const clean = String(text ?? '').trim();
    if (!clean) throw new Error('EMPTY_TEXT');
    if (!CHAT_ROLES.includes(role)) throw new Error(`INVALID_ROLE:${role}`);
    const message = {
      id: id || this.nextId(),
      role,
      text: clean,
      at: Date.now(),
    };
    this.messages.push(message);
    if (this.messages.length > MAX_MESSAGES) this.messages = this.messages.slice(-MAX_MESSAGES);
    await this.persist();
    return message;
  }

  /**
   * 清空历史（发号器不重置：id 全局唯一，旧卡片的 id 不会撞上新的）。
   * @returns {Promise<void>}
   */
  clear() {
    const next = this.chain.then(async () => {
      this.messages = [];
      await this.persist();
    });
    this.chain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }
}
