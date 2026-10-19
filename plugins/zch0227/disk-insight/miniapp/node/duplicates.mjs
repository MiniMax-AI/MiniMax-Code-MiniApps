// @ts-check
// 重复文件：先按大小分组，再比较头尾各 64 KB 的哈希，最后对剩下的文件算完整 SHA-256。
import { createHash } from 'node:crypto';
import { abortError, yieldNow } from './util.mjs';

const CHUNK = 64 * 1024;
const FULL_BUF = 1024 * 1024;

/**
 * @param {any} fs  需要 open(path, 'r') 返回 FileHandle
 * @param {string} path @param {number} size
 */
async function partialHash(fs, path, size) {
  let fh;
  try {
    fh = await fs.open(path, 'r');
    const h = createHash('sha256');
    h.update(String(size));
    const buf = Buffer.alloc(Math.min(CHUNK, size));
    const head = await fh.read(buf, 0, buf.length, 0);
    h.update(buf.subarray(0, head.bytesRead));
    if (size > CHUNK) {
      const tailLen = Math.min(CHUNK, size - CHUNK);
      const tbuf = Buffer.alloc(tailLen);
      const tail = await fh.read(tbuf, 0, tailLen, size - tailLen);
      h.update(tbuf.subarray(0, tail.bytesRead));
    }
    return h.digest('hex');
  } catch {
    return null;
  } finally {
    if (fh) await fh.close().catch(() => undefined);
  }
}

/**
 * @param {any} fs @param {string} path @param {AbortSignal} signal @param {(n: number) => void} onBytes
 */
async function fullHash(fs, path, signal, onBytes) {
  let fh;
  try {
    fh = await fs.open(path, 'r');
    const h = createHash('sha256');
    const buf = Buffer.alloc(FULL_BUF);
    let pos = 0;
    for (;;) {
      if (signal.aborted) throw abortError();
      const { bytesRead } = await fh.read(buf, 0, FULL_BUF, pos);
      if (!bytesRead) break;
      h.update(buf.subarray(0, bytesRead));
      pos += bytesRead;
      onBytes(bytesRead);
    }
    return h.digest('hex');
  } catch (e) {
    if (/** @type {any} */ (e).name === 'AbortError') throw e;
    return null;
  } finally {
    if (fh) await fh.close().catch(() => undefined);
  }
}

/**
 * @template T
 * @param {{
 *   bySize: Map<number, T[]>,
 *   fs: any,
 *   signal: AbortSignal,
 *   pathOf: (c: T) => string,
 *   progress: { files: number, bytes: number, currentPath: string },
 *   onGroup?: (g: { size: number, files: T[] }) => void,
 * }} o
 * @returns {Promise<{ size: number, files: T[] }[]>}
 */
export async function findDuplicateGroups(o) {
  const { bySize, fs, signal, pathOf, progress } = o;
  const sizes = [...bySize.keys()].filter((s) => (bySize.get(s) || []).length > 1).sort((a, b) => b - a);
  /** @type {{ size: number, files: T[] }[]} */
  const result = [];
  const push = (/** @type {{ size: number, files: T[] }} */ g) => {
    result.push(g);
    if (o.onGroup) o.onGroup(g);
  };
  let step = 0;
  for (const size of sizes) {
    if (signal.aborted) throw abortError();
    const cands = /** @type {T[]} */ (bySize.get(size));
    /** @type {Map<string, { c: T, p: string }[]>} */
    const byPartial = new Map();
    for (const c of cands) {
      if (signal.aborted) throw abortError();
      const p = pathOf(c);
      progress.currentPath = p;
      const h = await partialHash(fs, p, size);
      progress.files += 1;
      if (!h) continue;
      const arr = byPartial.get(h);
      if (arr) arr.push({ c, p });
      else byPartial.set(h, [{ c, p }]);
    }
    for (const group of byPartial.values()) {
      if (group.length < 2) continue;
      if (size <= 2 * CHUNK) {
        push({ size, files: group.map((g) => g.c) });
        continue;
      }
      /** @type {Map<string, T[]>} */
      const byFull = new Map();
      for (const { c, p } of group) {
        progress.currentPath = p;
        const h = await fullHash(fs, p, signal, (n) => {
          progress.bytes += n;
        });
        if (!h) continue;
        const arr = byFull.get(h);
        if (arr) arr.push(c);
        else byFull.set(h, [c]);
      }
      for (const files of byFull.values()) if (files.length >= 2) push({ size, files });
    }
    step += 1;
    if (step % 64 === 0) await yieldNow();
  }
  return result;
}
