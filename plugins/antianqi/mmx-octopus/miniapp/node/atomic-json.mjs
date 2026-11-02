// @ts-check

/**
 * 原子写 JSON —— **全库唯一的落盘实现**。
 *
 * **为什么抽出来**：本项目最忌讳「同一个判断分裂在两处」。
 * 之前 `chat.mjs` 用「先写 tmp 再 rename」保原子，`state.mjs` 却直接
 * `writeFile` 直写 —— 结果 `state.json` 写一半崩溃会留下**半截 JSON**，
 * 而 `load()` 里 `JSON.parse` 的异常被 `catch` **静默吞掉**，
 * 她的 **L2 专属会话绑定（`petSessionId`）就无声丢了**（她还活着，
 * 但换了房间、聊天历史接不上，而且没有任何提示）。
 * 两边各写一份 = 迟早有一份忘掉。现在只有这一份。
 *
 * **做法**（对齐官方 `minimax-pet` 的 `preferences-store.write` 与
 * `minimax-bot` 的 `store.writeJsonAtomic`）：
 *  1. 临时文件名带随机后缀 → 并发写不会互相踩
 *  2. `open(tmp, 'wx')` **独占创建** → 绝不复用别人的临时文件
 *  3. `handle.sync()` → 真正 fsync 到盘，不只是进 OS 缓存
 *  4. `rename(tmp, target)` → 同一卷内 rename 是原子的：要么是旧文件，
 *     要么是完整新文件，**不存在中间态**
 *  5. 失败时清掉临时文件，不留垃圾
 *
 * **写失败不抛**：落盘失败不该让整个运行时挂掉 —— 但**必须留痕**，
 * 否则就是「静默失败」的老毛病（见 `state.mjs` 的 `load()` 日志）。
 *
 * @module miniapp/node/atomic-json
 */

import { open, rename, mkdir, rm } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * 把一个值原子地写成 JSON 文件。
 *
 * @param {string} file 目标文件绝对路径
 * @param {unknown} value 要序列化的值
 * @param {{indent?: number}} [options]
 * @returns {Promise<void>}
 */
export async function writeJsonAtomic(file, value, options = {}) {
  const indent = options.indent ?? 2;
  const body = JSON.stringify(value, null, indent);
  await mkdir(dirname(file), { recursive: true });
  const tmp = join(dirname(file), `.${basename(file)}.${randomUUID()}.tmp`);
  /** @type {import('node:fs/promises').FileHandle | null} */
  let handle = null;
  try {
    // 'wx' = 独占创建，文件已存在就报错 —— 绝不覆盖别人的临时文件
    handle = await open(tmp, 'wx', 0o600);
    await handle.writeFile(body, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    // 原子发布：读者要么看到旧文件，要么看到完整的新文件
    await rename(tmp, file);
  } catch (error) {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // 关不掉就算了，别把原始错误盖掉
      }
    }
    try {
      await rm(tmp, { force: true });
    } catch {
      // 临时文件清不掉也不该掩盖原始错误
    }
    throw error;
  }
}

/**
 * 把一段文本原子地写进文件。
 *
 * **为什么要有这个（而不是裸 `writeFile`）**：身份层 `AGENTS.md` 要写进宿主给
 * 这个 Mini App 建的 agent 目录，宿主**每轮重读**它。写到一半被读到，
 * 模型就会看到半截身份（底稿有、规矩没有）—— 那比整份旧身份更糟。
 * 裸写没有这个保证，所以走同一套「临时文件 → fsync → rename」的原子发布。
 *
 * **和 `writeJsonAtomic` 的关系**：同一个原子发布的**唯一实现**，
 * 只是一个序列化、一个直接写文本。node 层**不允许**别处裸调 `writeFile`。
 *
 * @param {string} file 目标文件绝对路径
 * @param {string} text 要写的内容
 * @returns {Promise<void>}
 */
export async function writeTextAtomic(file, text) {
  const body = String(text ?? '');
  await mkdir(dirname(file), { recursive: true });
  const tmp = join(dirname(file), `.${basename(file)}.${randomUUID()}.tmp`);
  /** @type {import('node:fs/promises').FileHandle | null} */
  let handle = null;
  try {
    handle = await open(tmp, 'wx', 0o600);
    await handle.writeFile(body, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(tmp, file);
  } catch (error) {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // 关不掉就算了，别把原始错误盖掉
      }
    }
    try {
      await rm(tmp, { force: true });
    } catch {
      // 临时文件清不掉也不该掩盖原始错误
    }
    throw error;
  }
}

/**
 * 串行写队列 —— **同一份文件上的多次写排成一条链**。
 *
 * **为什么需要**：`commit()` 是散装调用的，多个 API 端点同时改状态时会
 * 并发调 `persist()`。即使每次写本身是原子的，两次 rename 之间仍可能
 * 出现「后写的先落盘」→ 旧数据覆盖新数据。串成一条链就杜绝了。
 *
 * 链上**不吞异常**：某次写失败不该让后面的写全部卡死 —— 用
 * `catch(() => undefined)` 把链恢复成 resolved，失败照样抛给调用方。
 *
 * @returns {(task: () => Promise<any>) => Promise<any>}
 */
export function createWriteQueue() {
  /** @type {Promise<any>} */
  let tail = Promise.resolve();
  return function run(task) {
    const next = tail.then(task);
    tail = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  };
}
