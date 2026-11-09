// @ts-check

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const MAX_TOTAL = 1e15;

/** @param {unknown} value */
export function normalizeTotal(value) {
  const number = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof number !== 'number' || !Number.isFinite(number)) return null;
  if (!Number.isInteger(number) || number < 1 || number > MAX_TOTAL) return null;
  return number;
}

/** @param {string} dataDir */
export function createStore(dataDir) {
  const file = join(dataDir, 'quota.json');
  const tmp = `${file}.${process.pid}.tmp`;
  let queue = Promise.resolve();

  return {
    /** @returns {Promise<number | null>} */
    async read() {
      try {
        const parsed = JSON.parse(await readFile(file, 'utf8'));
        return normalizeTotal(parsed?.total);
      } catch {
        return null;
      }
    },

    /** @param {number} total */
    write(total) {
      const next = queue.then(async () => {
        await mkdir(dataDir, { recursive: true });
        await writeFile(tmp, `${JSON.stringify({ total })}\n`, 'utf8');
        await rename(tmp, file);
        return total;
      });
      queue = next.catch(() => {});
      return next;
    },
  };
}
