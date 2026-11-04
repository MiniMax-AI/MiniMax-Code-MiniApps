/**
 * Writing files that hold a credential.
 *
 * A file the bridge writes with the default mode is readable by every account on
 * the machine. The bridge token is a credential for the account's room, so the
 * files that hold it are written for their owner only.
 */

import { chmod, open, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

/** The mode a file with a credential in it is written with. */
export const PRIVATE_FILE_MODE = 0o600;

/**
 * Writes a file only its owner can read.
 *
 * The mode of `writeFile` only applies to a file that is created, so a file that
 * already exists is set again - otherwise a configuration written before this
 * would keep the mode it was created with.
 *
 * @param {string} path
 * @param {string} contents
 */
export async function writePrivateFile(path, contents) {
  await writeFile(path, contents, { encoding: 'utf8', mode: PRIVATE_FILE_MODE });
  try {
    await chmod(path, PRIVATE_FILE_MODE);
  } catch {
    // A file system without modes (Windows) has nothing to set.
  }
}

/**
 * Replaces a private file only after its complete replacement has reached disk.
 * A failed write/sync/rename never truncates the previous file. This is not a
 * cross-process lock or a promise against filesystem/power-loss failures.
 * @param {string} path
 * @param {string} contents
 */
export async function writePrivateFileAtomic(path, contents) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let created = false;
  try {
    // Mark ownership before writing: a partial failed write still needs cleanup.
    const handle = await open(temporary, 'wx', PRIVATE_FILE_MODE);
    created = true;
    await handle.close();
    await writePrivateFile(temporary, contents);
    const complete = await open(temporary, 'r+');
    try { await complete.sync(); } finally { await complete.close(); }
    await rename(temporary, path);
    created = false;
  } finally {
    if (created) await unlink(temporary).catch(() => {});
  }
}
