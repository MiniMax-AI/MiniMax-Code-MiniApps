// @ts-check

/**
 * Durable state for the 公众号图文工作台.
 *
 * Everything the board owns lives under the Host-provided dataDir:
 *   dataDir/state.json               -> drafts, custom styles, publish checks
 *   dataDir/state.backup.json        -> the previous good state
 *   dataDir/state.corrupt-<stamp>.json -> a state file that could not be read
 *   dataDir/assets/<id>.ext          -> rendered cover / illustration bytes
 *
 * state.json is replaced atomically (temp file + rename) so a forced end
 * never leaves a half-written file behind.
 *
 * A state file that cannot be read is never overwritten: it is moved aside
 * under its own name first, and only then may a fresh state.json be written.
 */

import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BUILTIN_STYLES } from './styles.mjs';

const STATE_FILE = 'state.json';
const BACKUP_FILE = 'state.backup.json';
const RECOVERED_FILE = 'state.recovered.json';
const STATE_VERSION = 1;

/** @returns {any} */
function emptyState() {
  return {
    version: STATE_VERSION,
    drafts: [],
    styles: [],
    publishChecks: {},
    updatedAt: '',
    notice: '',
  };
}

/**
 * @param {unknown} parsed
 * @returns {any}
 */
function normalizeState(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyState();
  const source = /** @type {Record<string, unknown>} */ (parsed);
  const drafts = Array.isArray(source.drafts) ? source.drafts : [];
  const styles = Array.isArray(source.styles) ? source.styles : [];
  const publishChecks =
    source.publishChecks && typeof source.publishChecks === 'object' ? source.publishChecks : {};
  return {
    version: STATE_VERSION,
    drafts,
    styles,
    publishChecks,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : '',
    notice: typeof source.notice === 'string' ? source.notice : '',
  };
}

/**
 * A filesystem-safe stamp for the corrupt-state copy.
 *
 * @returns {string}
 */
function corruptStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function createStore(dataDir) {
  const statePath = join(dataDir, STATE_FILE);
  const backupPath = join(dataDir, BACKUP_FILE);
  const recoveredPath = join(dataDir, RECOVERED_FILE);
  const assetsDir = join(dataDir, 'assets');
  let state = emptyState();
  let chain = Promise.resolve();
  /**
   * True when the original state file could not be moved aside. While it is
   * set, nothing is ever written to state.json, so the damaged file survives.
   * @type {boolean}
   */
  let writesBlocked = false;
  /** @type {string} */
  let corruptBackupPath = '';

  async function init() {
    await mkdir(assetsDir, { recursive: true });
    let raw;
    try {
      raw = await readFile(statePath, 'utf8');
    } catch (error) {
      const code = /** @type {any} */ (error)?.code;
      if (code === 'ENOENT') {
        state = emptyState();
        return;
      }
      // The file is there but unreadable. Preserve it: move it aside under a
      // name of its own, and never write over it.
      await preserveDamagedState(`本地状态文件无法读取（${code || '未知错误'}）`);
      return;
    }

    try {
      state = normalizeState(JSON.parse(raw));
    } catch (error) {
      await preserveDamagedState('本地状态文件不是有效的 JSON');
    }
  }

  /**
   * Move a state file that could not be read out of the way.
   *
   * The damaged file keeps its exact bytes under `state.corrupt-<stamp>.json`.
   * When it cannot even be moved, writing to state.json is blocked for the
   * rest of the session, so the original is never overwritten.
   *
   * @param {string} reason
   */
  async function preserveDamagedState(reason) {
    state = emptyState();
    const target = join(dataDir, `state.corrupt-${corruptStamp()}.json`);
    try {
      await rename(statePath, target);
      corruptBackupPath = target;
      writesBlocked = false;
      state.notice = `${reason}，原文件已完整保留为 ${target.split(/[\\/]/).pop()}，工作台已重置为空白。`;
    } catch (error) {
      const code = /** @type {any} */ (error)?.code || '未知错误';
      corruptBackupPath = statePath;
      writesBlocked = true;
      state.notice = `${reason}，且无法移动原文件（${code}）。原文件保持原样，本应用不会写入 state.json，改动会保存到 ${RECOVERED_FILE}。`;
    }
  }

  function commit() {
    chain = chain.then(async () => {
      state.updatedAt = new Date().toISOString();
      const tmp = `${statePath}.tmp`;
      const target = writesBlocked ? recoveredPath : statePath;
      await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
      if (!writesBlocked) {
        // Keep the last good state beside the new one before replacing it.
        try {
          await copyFile(statePath, backupPath);
        } catch {
          // A missing previous state is normal on the first write.
        }
      }
      await rename(tmp, target);
    });
    return chain;
  }

  return {
    assetsDir,
    statePath,
    backupPath,
    get corruptBackupPath() {
      return corruptBackupPath;
    },
    get writesBlocked() {
      return writesBlocked;
    },
    init,
    /** @returns {any} */
    get state() {
      return state;
    },
    /**
     * Apply a mutation to the state and persist it before returning.
     * @param {(state: any) => void | Promise<void>} mutate
     */
    async mutate(mutate) {
      await mutate(state);
      await commit();
      return state;
    },
    /** Built-in styles plus the user's own. */
    styles() {
      return [...BUILTIN_STYLES, ...state.styles];
    },
    /**
     * @param {string} id
     * @returns {any | undefined}
     */
    draft(id) {
      return state.drafts.find((/** @type {any} */ d) => d.id === id);
    },
  };
}
