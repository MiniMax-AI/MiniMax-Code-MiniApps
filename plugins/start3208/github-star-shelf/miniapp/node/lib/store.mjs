import { mkdir, readFile, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite, nowIso } from './util.mjs';

export const DEFAULT_COLLECTION = 'default';

function defaults() {
  return {
    version: 1,
    settings: {
      githubUser: '',
      modelKey: '',
      concurrency: 2,
      effort: 'max',
      imageMode: 'github',
      agentDir: '',
      ghPath: '',
      gitPath: '',
      cloneMaxMB: 300,
    },
    collections: [
      {
        id: DEFAULT_COLLECTION,
        name: '默认收藏夹',
        description: '导入的 GitHub Star 先放在这里',
        isDefault: true,
        createdAt: nowIso(),
        order: 0,
      },
    ],
    projects: {},
    importReport: null,
  };
}

/** 所有持久化数据都在 dataDir：state.json 放结构化数据，readmes/ 放 README 缓存 */
export class Store {
  constructor(dataDir, logger) {
    this.dir = dataDir;
    this.file = join(dataDir, 'state.json');
    this.readmeDir = join(dataDir, 'readmes');
    this.logger = logger;
    this.state = defaults();
    this.rev = 0;
    this.dirty = false;
    this.timer = null;
    this.saving = Promise.resolve();
    this.readmeIndex = new Map();
    this.readmeIndexReady = false;
    this.closed = false;
  }

  async load() {
    await mkdir(this.readmeDir, { recursive: true });
    let raw = null;
    try {
      raw = await readFile(this.file, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') this.logger?.warn('shelf.store.read_failed', { code: error?.code });
    }
    if (!raw) return;
    try {
      this.state = this.#migrate(JSON.parse(raw));
    } catch {
      await rename(this.file, this.file + '.corrupt-' + Date.now()).catch(() => {});
      this.logger?.error('shelf.store.corrupt');
      this.state = defaults();
    }
  }

  #migrate(saved) {
    const d = defaults();
    const out = {
      ...d,
      ...saved,
      settings: { ...d.settings, ...(saved.settings || {}) },
      collections: Array.isArray(saved.collections) ? saved.collections : d.collections,
      projects: saved.projects && typeof saved.projects === 'object' ? saved.projects : {},
    };
    if (saved.settings && 'showImages' in saved.settings && !('imageMode' in saved.settings)) out.settings.imageMode = saved.settings.showImages ? 'github' : 'none';
    delete out.settings.showImages;
    delete out.settings.managerSessionId;
    if (!out.collections.some((c) => c.id === DEFAULT_COLLECTION)) out.collections.unshift(d.collections[0]);
    for (const p of Object.values(out.projects)) {
      p.collections = Array.isArray(p.collections) ? p.collections : [];
      p.notes = Array.isArray(p.notes) ? p.notes : [];
      p.chat = Array.isArray(p.chat) ? p.chat : [];
      p.explain = p.explain && typeof p.explain === 'object' ? p.explain : {};
    }
    return out;
  }

  /** 状态每次变化都要落盘；合并 400ms 内的多次写入 */
  touch() {
    this.rev += 1;
    if (this.closed) return; // 已经停止：迟到的变化不再写盘（目录可能已经没了）
    this.dirty = true;
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, 400);
    }
  }

  /** 停止时调用：把最后的状态写盘，之后不再写 */
  async close() {
    await this.flush();
    this.closed = true;
  }

  async flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty) return this.saving;
    this.dirty = false;
    const json = JSON.stringify(this.state);
    this.saving = this.saving
      .then(() => atomicWrite(this.file, json))
      .catch((error) => {
        this.dirty = true;
        this.logger?.error('shelf.store.save_failed', { code: error?.code });
      });
    return this.saving;
  }

  // ---- README 缓存 ----
  readmeFile(key) {
    return join(this.readmeDir, key + '.md');
  }
  async readReadme(key) {
    try {
      return await readFile(this.readmeFile(key), 'utf8');
    } catch {
      return null;
    }
  }
  async writeReadme(key, text) {
    await atomicWrite(this.readmeFile(key), text);
    if (this.readmeIndexReady) this.readmeIndex.set(key, text.toLowerCase());
  }
  async deleteReadme(key) {
    await rm(this.readmeFile(key), { force: true });
    this.readmeIndex.delete(key);
  }
  async ensureReadmeIndex() {
    if (this.readmeIndexReady) return;
    this.readmeIndexReady = true;
    let names = [];
    try {
      names = await readdir(this.readmeDir);
    } catch {
      names = [];
    }
    for (const name of names) {
      if (!name.endsWith('.md')) continue;
      const key = name.slice(0, -3);
      try {
        const text = await readFile(join(this.readmeDir, name), 'utf8');
        this.readmeIndex.set(key, text.toLowerCase());
      } catch {
        /* 跳过读不了的文件 */
      }
    }
  }
}
