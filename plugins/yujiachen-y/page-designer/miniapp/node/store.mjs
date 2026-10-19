// @ts-check
// Projects on disk. Each project is one page: its chat, its Agent session and every version.
//
//   <dataDir>/projects/<id>/project.json   metadata, transcript, run records
//   <dataDir>/projects/<id>/v<n>.html      version n of the page, exactly as published
//
// Writes go through a temp file and a rename, one project at a time.
import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateDesignHtml } from './artifact.mjs';

export const PROJECT_ID = /^p-[0-9a-f]{8}$/;
const MAX_MESSAGES = 1000;
const MAX_VERSIONS = 300;
const MAX_RUNS = 300;

export class StudioError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Trim, drop control characters except newlines and tabs, and cap the length.
 * @param {unknown} value @param {number} max
 */
export function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
}

/** @param {string} dataDir */
export function createStore(dataDir) {
  const root = join(dataDir, 'projects');
  /** @type {Map<string, any>} */
  const projects = new Map();
  /** @type {Map<string, Promise<unknown>>} */
  const queues = new Map();

  /** @param {string} id */
  const dirOf = (id) => join(root, id);

  /** @param {any} project */
  async function persist(project) {
    const dir = dirOf(project.id);
    await mkdir(dir, { recursive: true });
    const file = join(dir, 'project.json');
    const temp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(temp, JSON.stringify(project), 'utf8');
    await rename(temp, file);
  }

  /**
   * Run `task` after every earlier write of the same project has finished.
   * @template T @param {string} id @param {() => Promise<T>} task @returns {Promise<T>}
   */
  function serialize(id, task) {
    const previous = queues.get(id) ?? Promise.resolve();
    const next = previous.then(task, task);
    const tail = next.catch(() => {});
    queues.set(id, tail);
    void tail.then(() => {
      if (queues.get(id) === tail) queues.delete(id);
    });
    return next;
  }

  /** @param {string} id */
  function find(id) {
    const project = typeof id === 'string' && PROJECT_ID.test(id) ? projects.get(id) : undefined;
    if (!project) throw new StudioError('not_found', 'This page no longer exists.');
    return project;
  }

  /** @param {any} project */
  function trim(project) {
    if (project.messages.length > MAX_MESSAGES) project.messages.splice(0, project.messages.length - MAX_MESSAGES);
    if (project.runs.length > MAX_RUNS) project.runs.splice(0, project.runs.length - MAX_RUNS);
  }

  return {
    async load() {
      await mkdir(root, { recursive: true });
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !PROJECT_ID.test(entry.name)) continue;
        try {
          const project = JSON.parse(await readFile(join(root, entry.name, 'project.json'), 'utf8'));
          if (project?.id !== entry.name || !Array.isArray(project.versions) || !Array.isArray(project.messages)) continue;
          project.runs = Array.isArray(project.runs) ? project.runs : [];
          // A run that was in flight when the process stopped did not finish here.
          for (const run of project.runs) {
            if (run.status === 'running') Object.assign(run, { status: 'interrupted', endedAt: run.endedAt ?? Date.now() });
          }
          projects.set(project.id, project);
        } catch {
          // An unreadable project is skipped and left on disk untouched.
        }
      }
    },

    list() {
      return [...projects.values()]
        .map((project) => ({
          id: project.id,
          title: project.title,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          versions: project.versions.length,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },

    find,

    /**
     * @param {{ title?: string, style?: { id: string, name: string, text: string } | null,
     *   model?: object | null, origin: 'page' | 'mcp' }} input
     */
    async create(input) {
      let id = '';
      do id = `p-${randomBytes(4).toString('hex')}`;
      while (projects.has(id));
      const now = Date.now();
      const project = {
        id,
        title: cleanText(input.title, 80) || 'Untitled page',
        createdAt: now,
        updatedAt: now,
        origin: input.origin,
        sessionId: null,
        primedSessionId: null,
        model: input.model ?? null,
        style: input.style ?? null,
        messages: [],
        versions: [],
        runs: [],
        pendingQuestion: null,
      };
      await serialize(id, () => persist(project));
      projects.set(id, project);
      return project;
    },

    /**
     * Change a project in memory and persist it. The mutator may throw to cancel the change.
     * @template T @param {string} id @param {(project: any) => T} mutate @returns {Promise<T>}
     */
    update(id, mutate) {
      return serialize(id, async () => {
        const project = find(id);
        const draft = structuredClone(project);
        const result = mutate(draft);
        draft.updatedAt = Date.now();
        trim(draft);
        await persist(draft);
        projects.set(id, draft);
        return result;
      });
    },

    /**
     * Store a new version when the HTML passes validation and differs from the latest one.
     * @param {string} id @param {string} html
     * @param {{ via: 'publish' | 'edit', runId: string | null, title?: string }} meta
     */
    addVersion(id, html, meta) {
      return serialize(id, async () => {
        const project = find(id);
        const validation = validateDesignHtml(html);
        if (!validation.ok) throw new StudioError('invalid_design', `${validation.error} (nothing was published)`);
        const latest = project.versions.at(-1);
        if (latest) {
          const current = await readFile(join(dirOf(id), `v${latest.n}.html`), 'utf8').catch(() => null);
          if (current === html) return { project, version: latest, changed: false };
        }
        if (project.versions.length >= MAX_VERSIONS) {
          throw new StudioError('too_many_versions', `This page already has ${MAX_VERSIONS} versions. Start a new page to keep going.`);
        }
        const n = (latest?.n ?? 0) + 1;
        const dir = dirOf(id);
        await mkdir(dir, { recursive: true });
        const file = join(dir, `v${n}.html`);
        const temp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
        await writeFile(temp, html, 'utf8');
        await rename(temp, file);

        const draft = structuredClone(project);
        const version = { n, at: Date.now(), bytes: validation.bytes, via: meta.via, runId: meta.runId };
        draft.versions.push(version);
        draft.messages.push({ id: randomBytes(6).toString('hex'), kind: 'version', at: version.at, n, via: meta.via, runId: meta.runId });
        const title = cleanText(meta.title, 80);
        if (title) draft.title = title;
        draft.updatedAt = version.at;
        trim(draft);
        await persist(draft);
        projects.set(id, draft);
        return { project: draft, version, changed: true };
      });
    },

    /** @param {string} id @param {number} n */
    async readVersion(id, n) {
      const project = find(id);
      const version = project.versions.find((/** @type {any} */ item) => item.n === n);
      if (!version) throw new StudioError('not_found', 'This version no longer exists.');
      return readFile(join(dirOf(id), `v${n}.html`), 'utf8');
    },

    /** @param {string} id */
    async latestHtml(id) {
      const project = find(id);
      const latest = project.versions.at(-1);
      if (!latest) return { html: null, revision: 0 };
      return { html: await readFile(join(dirOf(id), `v${latest.n}.html`), 'utf8'), revision: latest.n };
    },

    /** @param {string} id */
    remove(id) {
      return serialize(id, async () => {
        find(id);
        projects.delete(id);
        await rm(dirOf(id), { recursive: true, force: true });
      });
    },
  };
}
