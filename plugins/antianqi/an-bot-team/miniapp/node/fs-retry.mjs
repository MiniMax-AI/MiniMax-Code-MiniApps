// @ts-check
import { rename } from 'node:fs/promises';

/**
 * Windows answers a rename with EPERM, EACCES or EBUSY while an indexer, a virus scanner or
 * another writer holds the file open for a moment. The bytes are already written at that
 * point, so the answer is to wait and try again instead of losing the file.
 */
const TRANSIENT = new Set(['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY']);

/** The wait between two tries: it grows, but it never outgrows the moment a scan takes. */
const DELAY_CAP_MS = 400;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Rename a file, retrying while the operating system reports a transient lock.
 * @param {string} from
 * @param {string} to
 * @param {{ attempts?: number, baseDelayMs?: number }} [options]
 * @returns {Promise<void>}
 */
export async function renameWithRetry(from, to, options = {}) {
  const attempts = options.attempts ?? 10;
  const baseDelayMs = options.baseDelayMs ?? 20;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const transient = TRANSIENT.has(error?.code);
      if (!transient || attempt + 1 >= attempts) throw error;
      await wait(Math.min(baseDelayMs * 2 ** attempt, DELAY_CAP_MS));
    }
  }
}
