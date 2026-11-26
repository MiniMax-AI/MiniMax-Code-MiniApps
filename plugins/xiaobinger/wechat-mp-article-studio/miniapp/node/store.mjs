// @ts-check

/**
 * Durable state for the 公众号图文工作台.
 *
 * Everything the board owns lives under the Host-provided dataDir:
 *   dataDir/state.json      -> drafts, custom styles, publish checks
 *   dataDir/assets/<id>.ext -> rendered cover / illustration bytes
 *
 * state.json is replaced atomically (temp file + rename) so a forced end
 * never leaves a half-written file behind.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BUILTIN_STYLES } from './styles.mjs';

const STATE_FILE = 'state.json';
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

export function createStore(dataDir) {
  const statePath = join(dataDir, STATE_FILE);
  const assetsDir = join(dataDir, 'assets');
  let state = emptyState();
  let chain = Promise.resolve();

  async function init() {
    await mkdir(assetsDir, { recursive: true });
    try {
      const raw = await readFile(statePath, 'utf8');
      state = normalizeState(JSON.parse(raw));
    } catch (error) {
      const code = /** @type {any} */ (error)?.code;
      if (code === 'ENOENT') {
        state = emptyState();
      } else {
        // A damaged state file is reported to the user instead of silently
        // pretending the workspace was always empty.
        state = emptyState();
        state.notice = '本地状态文件无法读取，已重置为空白工作台；原文件保留在 dataDir 中未被覆盖。';
      }
    }
  }

  function commit() {
    chain = chain.then(async () => {
      state.updatedAt = new Date().toISOString();
      const tmp = `${statePath}.tmp`;
      await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
      await rename(tmp, statePath);
    });
    return chain;
  }

  return {
    assetsDir,
    statePath,
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
