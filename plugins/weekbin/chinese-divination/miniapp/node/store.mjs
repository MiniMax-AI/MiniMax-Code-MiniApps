// @ts-check

/**
 * 卦历持久化。所有状态写在 context.dataDir 下的单个 JSON 文件里，原子替换，避免写坏。
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { clampText } from './cast-params.mjs';

const MAX_ENTRIES = 500;
const MAX_NOTE = 2000;

/**
 * 落盘是「写临时文件再改名」。在 Windows 上，改名可能整个失败：
 * 目标文件正被别的进程打开且未共享删除权限时（杀毒扫描、Windows Search 索引
 * 都可能占着），Node 报 EPERM 或 EACCES。这不是部分写入——是压根没换。
 * 退避重试几次，对方松手就成了。其余错误码重试也没用，直接抛。
 * 累计等待约 400ms，对一次保存来说察觉不到。
 */
const RENAME_ATTEMPTS = 4;
const RENAME_BACKOFF_MS = 40;
const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

/**
 * 该不该为这个错误再试一次。
 * @param {unknown} error
 * @param {number} attempt 已经重试过几次
 * @returns {boolean}
 */
export function shouldRetryRename(error, attempt) {
  if (attempt >= RENAME_ATTEMPTS) return false;
  const code = /** @type {NodeJS.ErrnoException} */ (error)?.code;
  return typeof code === 'string' && RENAME_RETRY_CODES.has(code);
}

export class ReadingStore {
  /** @param {string} dataDir */
  constructor(dataDir) {
    this.file = join(dataDir, 'readings.json');
    /** @type {Promise<object[]>} */
    this.queue = Promise.resolve([]);
  }

  async list() {
    return this.enqueue(async () => {
      const entries = await this.readAll();
      return entries.map(toSummary);
    });
  }

  /** @param {string} id */
  async get(id) {
    return this.enqueue(async () => {
      const entries = await this.readAll();
      return entries.find((entry) => entry.id === id) ?? null;
    });
  }

  /**
   * @param {import('./divination.mjs').Reading} reading
   * @param {string} note
   */
  async save(reading, note) {
    return this.enqueue(async () => {
      const entries = await this.readAll();
      const entry = {
        ...reading,
        note: clampText(note, MAX_NOTE),
      };
      entries.unshift(entry);
      const trimmed = entries.slice(0, MAX_ENTRIES);
      await this.writeAll(trimmed);
      return toSummary(entry);
    });
  }

  /**
   * 改批注这条路原先留着 update()，但服务端没有对应的路由、客户端也不调它，
   * 它写下的 updatedAt 只有 toSummary 会读，而那永远读不到——是个恒为 undefined
   * 的死字段。与其留着一条永远走不到的分支，不如等「改批注」真要做时连它一起加回来。
   */

  /** @param {string} id */
  async remove(id) {
    return this.enqueue(async () => {
      const entries = await this.readAll();
      const next = entries.filter((entry) => entry.id !== id);
      if (next.length === entries.length) return false;
      await this.writeAll(next);
      return true;
    });
  }

  /** 串行化写入，避免并发请求交错写文件。 */
  enqueue(task) {
    const next = this.queue.then(task, task);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async readAll() {
    let raw;
    try {
      raw = await readFile(this.file, 'utf8');
    } catch (error) {
      if (error && /** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return [];
      throw error;
    }
    // 读得到、却不是一份能解析的 JSON，说明这份落盘文件坏了：写到一半被打断、
    // 被别的程序改过、或者被同步软件截断。从前是直接抛，于是 list/save/remove
    // 全线 500，卦历打不开，用户连自救的入口都没有。现在把坏的那份挪到一边
    // 另存、当空表继续走：卦历立刻回到能用，坏的内容留在盘上还能捞。
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      await this.setAside();
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) => entry && typeof entry.id === 'string');
  }

  /**
   * 把坏掉的落盘文件挪开。不删：里面可能有用户手写的批注，捞得回来。
   * 挪不动也不抛——读路径不该因为善后失败而失败，下一次写入会直接盖掉它。
   */
  async setAside() {
    try {
      await rename(this.file, `${this.file}.corrupt-${Date.now()}`);
    } catch {
      // 善后尽力而为
    }
  }

  async writeAll(entries) {
    await mkdir(dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    await writeFile(temp, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rename(temp, this.file);
        return;
      } catch (error) {
        if (!shouldRetryRename(error, attempt)) throw error;
        await delay(RENAME_BACKOFF_MS * (attempt + 1));
      }
    }
  }
}

function toSummary(entry) {
  return {
    id: entry.id,
    method: entry.method,
    question: entry.question ?? '',
    note: entry.note ?? '',
    createdAt: entry.createdAt,
    hexagram: entry.hexagram,
    changed: entry.changed,
    verdict: entry.verdict
      ? { key: entry.verdict.key, label: entry.verdict.label, summary: entry.verdict.summary }
      : undefined,
    timing: entry.timing ?? '',
    topic: entry.topic ?? null,
    structure: entry.structure,
  };
}

export { MAX_NOTE, MAX_ENTRIES };
