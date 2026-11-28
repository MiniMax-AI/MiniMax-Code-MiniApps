import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  fileMeta,
  listFiles,
  readJson,
  readJsonChecked,
  readText,
  resolveInside,
  slugify,
  toPosix,
  writeJsonAtomic,
  writeText,
} from './fsx.mjs';
import { classify, STATE_RELS, workbenchPaths } from './policy.mjs';
import { ensureScaffold } from './scaffold.mjs';

export const EMPTY_CURRICULUM = {
  schemaVersion: 1,
  topic: '',
  updatedAt: 0,
  modules: [],
};

const EMPTY_ANNOTATIONS = { schemaVersion: 1, items: [] };
const EMPTY_NOTES = { schemaVersion: 1, items: [] };
const EMPTY_SESSIONS = { schemaVersion: 1, sessions: {} };

let DATA_DIR = '';

/**
 * Files written by the app itself during a turn, per workspace root.
 * A restore must leave those alone: only an out-of-scope session write is
 * reverted, and node's own bookkeeping (curriculum, indexes) is not a
 * violation even when it lands inside the same time window.
 */
let writeSeq = 0;
const nodeWrites = new Map();
const rootKey = (root) => path.resolve(root).toLowerCase();

function markNodeWrite(root, rel) {
  const key = rootKey(root);
  let marks = nodeWrites.get(key);
  if (!marks) {
    marks = new Map();
    nodeWrites.set(key, marks);
  }
  marks.set(rel, ++writeSeq);
}

export function nodeWriteCursor() {
  return writeSeq;
}

export function nodeWritesAfter(root, cursor) {
  const marks = nodeWrites.get(rootKey(root));
  const out = new Set();
  if (!marks) return out;
  for (const [rel, seq] of marks) {
    if (seq > cursor) out.add(rel);
  }
  return out;
}

/**
 * Cleans that already started, per workspace root.
 *
 * A turn that was running when 「清理产物」 began must not write its state back or
 * restore what the clean deleted. The clean claims its paths before the first
 * rm; a turn compares the cursor it took when it started.
 */
let cleanSeq = 0;
const cleanLog = new Map();

export function cleanCursor() {
  return cleanSeq;
}

export function cleanSince(root, cursor) {
  const list = cleanLog.get(rootKey(root)) ?? [];
  return list.filter((entry) => entry.seq > (cursor ?? 0));
}

export function markClean(root, { keys = [], paths = [] } = {}) {
  const key = rootKey(root);
  const entry = { seq: ++cleanSeq, keys: [...keys], paths: [...paths], at: Date.now() };
  // Keep the log short: only turns that started before the newest clean matter.
  cleanLog.set(key, [...(cleanLog.get(key) ?? []).slice(-7), entry]);
  return entry.seq;
}

export function initStore(dataDir) {
  DATA_DIR = dataDir;
  return dataDir;
}

export function workspaceId(root) {
  const key = path.resolve(root).toLowerCase();
  return `ws_${createHash('sha1').update(key).digest('hex').slice(0, 10)}`;
}

/* ------------------------------------------------------------------ locks */

const chains = new Map();

export function withLock(key, fn) {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  chains.set(
    key,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

/* --------------------------------------------------------------- registry */

function registryPath() {
  return path.join(DATA_DIR, 'registry.json');
}

async function readRegistry() {
  const raw = await readJson(registryPath(), { schemaVersion: 1, workspaces: [] });
  const list = Array.isArray(raw.workspaces) ? raw.workspaces : [];
  return {
    schemaVersion: 1,
    workspaces: list.filter((item) => item && typeof item.root === 'string'),
  };
}

export async function listWorkspaces() {
  const registry = await readRegistry();
  const out = [];
  for (const item of registry.workspaces) {
    if (!existsSync(item.root)) continue;
    out.push({
      ...item,
      name: item.name || path.basename(item.root),
      exists: true,
    });
  }
  out.sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0));
  return out;
}

export async function getWorkspace(id) {
  const registry = await readRegistry();
  const found = registry.workspaces.find((item) => item.id === id);
  if (!found) return null;
  if (!existsSync(found.root)) return null;
  return found;
}

async function saveRegistry(registry) {
  await writeJsonAtomic(registryPath(), registry);
}

export async function registerWorkspace(root, { name, touch = true } = {}) {
  return withLock('registry', async () => {
    const registry = await readRegistry();
    const id = workspaceId(root);
    const now = Date.now();
    const existing = registry.workspaces.find((item) => item.id === id);
    if (existing) {
      existing.root = root;
      if (name) existing.name = name;
      if (touch) existing.lastOpenedAt = now;
    } else {
      registry.workspaces.push({
        id,
        root,
        name: name || path.basename(root),
        createdAt: now,
        lastOpenedAt: now,
      });
    }
    await saveRegistry(registry);
    return registry.workspaces.find((item) => item.id === id);
  });
}

export async function forgetWorkspace(id) {
  return withLock('registry', async () => {
    const registry = await readRegistry();
    registry.workspaces = registry.workspaces.filter((item) => item.id !== id);
    await saveRegistry(registry);
  });
}

/* -------------------------------------------------------------- workspace */

export async function readMeta(root) {
  return readJson(workbenchPaths(root).meta, null);
}

export async function writeMeta(root, meta) {
  await writeJsonAtomic(workbenchPaths(root).meta, { schemaVersion: 1, ...meta });
  markNodeWrite(root, STATE_RELS.meta);
}

async function initStateFiles(root) {
  const p = workbenchPaths(root);
  if (!existsSync(p.curriculum)) await writeJsonAtomic(p.curriculum, EMPTY_CURRICULUM);
  if (!existsSync(p.annotations)) await writeJsonAtomic(p.annotations, EMPTY_ANNOTATIONS);
  if (!existsSync(p.notes)) await writeJsonAtomic(p.notes, EMPTY_NOTES);
  if (!existsSync(p.sessions)) await writeJsonAtomic(p.sessions, EMPTY_SESSIONS);
}

export async function createWorkspace({ parentPath }) {
  const root = path.resolve(parentPath);
  const info = await stat(root).catch(() => null);
  if (!info || !info.isDirectory()) {
    const error = new Error('parent_not_found');
    error.code = 'PARENT_NOT_FOUND';
    throw error;
  }
  // Scaffolding the home directory or a drive root is always a mistake; it
  // normally means the dialog fell back to a stale path.
  if (root.toLowerCase() === path.resolve(os.homedir()).toLowerCase()) {
    const error = new Error('home_not_allowed');
    error.code = 'HOME_NOT_ALLOWED';
    throw error;
  }
  if (path.dirname(root) === root) {
    const error = new Error('drive_root_not_allowed');
    error.code = 'DRIVE_ROOT_NOT_ALLOWED';
    throw error;
  }

  const existing = await readMeta(root);
  const label = existing?.topic || path.basename(root);
  await ensureScaffold(root, { topic: label });
  const now = Date.now();
  const id = workspaceId(root);
  await writeMeta(root, {
    id,
    topic: existing?.topic ?? '',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    mainSessionId: existing?.mainSessionId ?? null,
    mainSeededAt: existing?.mainSeededAt ?? null,
    setupSessionId: existing?.setupSessionId ?? null,
  });
  await initStateFiles(root);
  const registered = await registerWorkspace(root, { name: existing?.topic || path.basename(root) });
  return { root, workspace: registered, existing: Boolean(existing) };
}

export async function importWorkspace({ root: rawRoot }) {
  const root = path.resolve(rawRoot);
  const meta = await readMeta(root);
  if (!meta) {
    const error = new Error('not_a_workspace');
    error.code = 'NOT_A_WORKSPACE';
    throw error;
  }
  await ensureScaffold(root, { topic: meta.topic || path.basename(root) });
  await initStateFiles(root);
  if (!meta.id || meta.id !== workspaceId(root)) {
    await writeMeta(root, { ...meta, id: workspaceId(root) });
  }
  const mission = await readText(path.join(root, 'MISSION.md'), '');
  const label = readMission(mission).title || meta.topic || path.basename(root);
  const registered = await registerWorkspace(root, { name: label });
  return { root, workspace: registered };
}

/* ------------------------------------------------------------- curriculum */

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value, fallback = '') {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return fallback;
}

function toMinutes(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 20;
  return Math.min(60, Math.max(10, Math.round(n)));
}

/**
 * Normalize whatever the Agent wrote into the canonical curriculum, keeping
 * per-lesson state (session binding, generated file, status) across regenerations.
 */
export function normalizeCurriculum(raw, previous = EMPTY_CURRICULUM, topic = '') {
  const source = raw && typeof raw === 'object' ? raw : {};
  const modulesRaw = asArray(source.modules ?? source.curriculum ?? source.syllabus);
  const prevLessons = [];
  for (const module of asArray(previous?.modules)) {
    for (const lesson of asArray(module.lessons)) prevLessons.push(lesson);
  }
  const prevById = new Map(prevLessons.map((lesson) => [lesson.id, lesson]));
  const prevByTitle = new Map(prevLessons.map((lesson) => [lesson.title, lesson]));
  const issues = [];
  let no = 0;
  const modules = [];

  modulesRaw.forEach((module, moduleIndex) => {
    if (!module || typeof module !== 'object') return;
    const lessonsRaw = asArray(module.lessons ?? module.items);
    const lessons = [];
    lessonsRaw.forEach((lesson) => {
      if (!lesson || typeof lesson !== 'object') return;
      const title = text(lesson.title ?? lesson.name);
      if (!title) {
        issues.push(`模块 ${moduleIndex + 1} 有一节课缺少 title`);
        return;
      }
      no += 1;
      const previousMatch =
        (lesson.id && prevById.get(lesson.id)) || prevByTitle.get(title) || null;
      const id = text(lesson.id) || previousMatch?.id || `l${no}`;
      const prev = prevById.get(id) || previousMatch;
      const status = ['planned', 'active', 'done'].includes(lesson.status)
        ? lesson.status
        : (prev?.status ?? 'planned');
      lessons.push({
        id,
        no,
        title,
        objective: text(lesson.objective ?? lesson.goal),
        minutes: toMinutes(lesson.minutes ?? lesson.estimateMinutes),
        status,
        file: text(lesson.file) || prev?.file || '',
        sessionId: text(lesson.sessionId) || prev?.sessionId || '',
        notes: text(lesson.notes),
      });
    });
    if (!lessons.length) return;
    modules.push({
      id: text(module.id) || `m${moduleIndex + 1}`,
      title: text(module.title ?? module.name) || `模块 ${moduleIndex + 1}`,
      goal: text(module.goal ?? module.description),
      lessons,
    });
  });

  return {
    value: {
      schemaVersion: 1,
      topic: text(source.topic) || topic,
      updatedAt: Number(source.updatedAt) || Date.now(),
      modules,
    },
    issues,
  };
}

export async function readCurriculum(root, meta) {
  const p = workbenchPaths(root);
  const checked = await readJsonChecked(p.curriculum, null);
  if (!checked.value) {
    return {
      curriculum: { ...EMPTY_CURRICULUM, topic: meta?.topic ?? '' },
      error: checked.error,
      mtime: 0,
    };
  }
  const previous = checked.value;
  const { value, issues } = normalizeCurriculum(previous, previous, meta?.topic ?? '');
  const info = await fileMeta(root, STATE_RELS.curriculum);
  return {
    curriculum: { ...value, issues },
    error: checked.error,
    mtime: info?.mtime ?? 0,
  };
}

export async function writeCurriculum(root, curriculum) {
  const out = {
    schemaVersion: 1,
    topic: curriculum.topic,
    updatedAt: Date.now(),
    modules: curriculum.modules.map((module) => ({
      id: module.id,
      title: module.title,
      goal: module.goal,
      lessons: module.lessons.map((lesson) => ({
        id: lesson.id,
        no: lesson.no,
        title: lesson.title,
        objective: lesson.objective,
        minutes: lesson.minutes,
        status: lesson.status,
        file: lesson.file,
        sessionId: lesson.sessionId,
        notes: lesson.notes,
      })),
    })),
  };
  await writeJsonAtomic(workbenchPaths(root).curriculum, out);
  markNodeWrite(root, STATE_RELS.curriculum);
  return out;
}

export async function mutateCurriculum(root, meta, mutator) {
  return withLock(`ws:${root}`, async () => {
    const { curriculum } = await readCurriculum(root, meta);
    const next = mutator(structuredClone(curriculum));
    if (!next) return null;
    const saved = await writeCurriculum(root, next);
    return { ...saved, issues: [] };
  });
}

/** Copy the current curriculum aside so a rewrite cannot lose per-lesson state. */
export async function backupCurriculum(root) {
  const current = await readJson(workbenchPaths(root).curriculum, null);
  if (current) {
    await writeJsonAtomic(workbenchPaths(root).curriculumBackup, current);
    markNodeWrite(root, STATE_RELS.curriculumBackup);
  }
  return current;
}

export async function readCurriculumBackup(root) {
  return readJson(workbenchPaths(root).curriculumBackup, null);
}

/**
 * Import the curriculum the Agent wrote to disk. `options.previous` supplies the
 * pre-rewrite snapshot so lesson sessions, files and status survive regeneration.
 */
export async function importCurriculum(root, meta, options = {}) {
  return withLock(`ws:${root}`, async () => {
    const p = workbenchPaths(root);
    const checked = await readJsonChecked(p.curriculum, null);
    if (!checked.value) {
      return { curriculum: { ...EMPTY_CURRICULUM, topic: meta?.topic ?? '' }, error: checked.error ?? 'missing' };
    }
    const previous =
      options.previous ?? (await readJson(p.curriculum, EMPTY_CURRICULUM));
    const { value, issues } = normalizeCurriculum(checked.value, previous, meta?.topic ?? '');
    if (!value.modules.length) {
      return { curriculum: { ...previous, issues }, error: checked.error ?? 'no_modules' };
    }
    const saved = await writeCurriculum(root, value);
    return { curriculum: { ...saved, issues }, error: checked.error };
  });
}

export function allLessons(curriculum) {
  const out = [];
  for (const module of asArray(curriculum?.modules)) {
    for (const lesson of asArray(module.lessons)) out.push(lesson);
  }
  return out;
}

export function findLesson(curriculum, lessonId) {
  return allLessons(curriculum).find((lesson) => lesson.id === lessonId) ?? null;
}

/* ------------------------------------------------------------ annotations */

export async function readAnnotations(root) {
  const raw = await readJson(workbenchPaths(root).annotations, EMPTY_ANNOTATIONS);
  const items = asArray(raw.items)
    .filter((item) => item && typeof item.id === 'string' && typeof item.lessonId === 'string')
    .map((item) => ({
      id: item.id,
      lessonId: item.lessonId,
      quote: text(item.quote),
      note: text(item.note),
      createdAt: Number(item.createdAt) || 0,
      updatedAt: Number(item.updatedAt) || 0,
    }));
  return { schemaVersion: 1, items };
}

export async function mutateAnnotations(root, mutator) {
  return withLock(`ws:${root}`, async () => {
    const current = await readAnnotations(root);
    const next = mutator(structuredClone(current));
    if (!next) return current;
    await writeJsonAtomic(workbenchPaths(root).annotations, next);
    markNodeWrite(root, STATE_RELS.annotations);
    return next;
  });
}

/* ------------------------------------------------------------------ notes */

export async function readNotes(root) {
  const raw = await readJson(workbenchPaths(root).notes, EMPTY_NOTES);
  const items = asArray(raw.items)
    .filter((item) => item && typeof item.id === 'string')
    .map((item) => ({
      id: item.id,
      title: text(item.title),
      path: text(item.path),
      lessonIds: asArray(item.lessonIds).filter((id) => typeof id === 'string'),
      sessionId: text(item.sessionId),
      status: ['running', 'ready', 'failed'].includes(item.status) ? item.status : 'running',
      createdAt: Number(item.createdAt) || 0,
      updatedAt: Number(item.updatedAt) || 0,
    }));
  return { schemaVersion: 1, items };
}

export async function mutateNotes(root, mutator) {
  return withLock(`ws:${root}`, async () => {
    const current = await readNotes(root);
    const next = mutator(structuredClone(current));
    if (!next) return current;
    await writeJsonAtomic(workbenchPaths(root).notes, next);
    markNodeWrite(root, STATE_RELS.notes);
    return next;
  });
}

/**
 * Drop index entries whose files no longer exist.
 * 「清理产物」deletes lesson HTML and note files, so the indexes must forget those
 * entries instead of handing the UI paths that 404.
 */
export async function reconcileWorkspaceFiles(root, { lessons = false, notes = false } = {}) {
  let notesPruned = 0;
  let lessonsReset = 0;

  if (notes) {
    await mutateNotes(root, (current) => {
      const kept = current.items.filter((item) => {
        if (!item.path) return item.status === 'running';
        const alive = existsSync(resolveInside(root, item.path));
        if (!alive) notesPruned += 1;
        return alive;
      });
      return kept.length === current.items.length ? null : { ...current, items: kept };
    });
  }

  if (lessons) {
    await mutateCurriculum(root, {}, (current) => {
      let changed = false;
      for (const module of current.modules) {
        for (const lesson of module.lessons) {
          if (!lesson.file || existsSync(resolveInside(root, lesson.file))) continue;
          lesson.file = '';
          if (lesson.status !== 'planned') lesson.status = 'planned';
          changed = true;
          lessonsReset += 1;
        }
      }
      return changed ? current : null;
    });
  }

  return { notesPruned, lessonsReset };
}

/* --------------------------------------------------------------- sessions */

export async function readSessions(root) {
  const raw = await readJson(workbenchPaths(root).sessions, EMPTY_SESSIONS);
  const all = raw && typeof raw.sessions === 'object' && raw.sessions ? raw.sessions : {};
  const sessions = {};
  for (const [id, session] of Object.entries(all)) {
    if (!session || typeof session !== 'object') continue;
    // A session names the workspace whose turn wrote it. A record whose root is
    // gone can only be a leftover of a deleted or copied workspace, so it must
    // not surface in this workspace's list.
    if (session.root && !existsSync(session.root)) continue;
    sessions[id] = session;
  }
  return { schemaVersion: 1, sessions };
}

export async function getSession(root, sessionId) {
  const store = await readSessions(root);
  return store.sessions[sessionId] ?? null;
}

export async function saveSession(root, session) {
  return withLock(`ws:${root}`, async () => {
    const store = await readSessions(root);
    store.sessions[session.id] = session;
    // Keep transcripts bounded so the state file stays readable.
    if (Array.isArray(session.messages) && session.messages.length > 600) {
      session.messages = session.messages.slice(-600);
    }
    await writeJsonAtomic(workbenchPaths(root).sessions, store);
    markNodeWrite(root, STATE_RELS.sessions);
    return session;
  });
}

/** Shared session shape for every API response and SSE event. */
export function sessionSummary(session) {
  const messages = Array.isArray(session.messages) ? session.messages : [];
  return {
    id: session.id,
    kind: session.kind,
    targetId: session.targetId ?? '',
    title: session.title ?? '',
    updatedAt: session.updatedAt ?? 0,
    messageCount: messages.length,
    running: Boolean(session.running),
    pending: session.pending ?? null,
    permissions: Array.isArray(session.permissions) ? session.permissions : [],
    seeded: Boolean(session.seeded),
    model: session.model ?? null,
    // Record size only: the Host keeps the real context and its own compaction.
    turns: messages.filter((message) => message.role === 'assistant').length,
    chars: messages.reduce((sum, message) => sum + String(message.text ?? '').length, 0),
  };
}

export function makeMessage(role, messageText, extra = {}) {
  return {
    id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    role,
    text: String(messageText ?? ''),
    at: Date.now(),
    ...extra,
  };
}

/* --------------------------------------------------------------- snapshot */

async function listRecords(root) {
  const files = await listFiles(root, { extensions: ['.md'], max: 200 });
  const records = files.filter((rel) => classify(rel).id === 'records');
  const out = [];
  for (const rel of records.slice(0, 40)) {
    const body = await readText(resolveInside(root, rel), '');
    const firstLine = body.split('\n').find((line) => line.startsWith('# '));
    const title = firstLine?.slice(2).trim() || path.basename(rel, '.md');
    const excerpt = body
      .split('\n')
      .filter((line) => line.trim() && !line.startsWith('#'))
      .join(' ')
      .slice(0, 220);
    out.push({ rel, title, excerpt });
  }
  return out;
}

/**
 * The only reader of MISSION.md. Everything else consumes this shape: the
 * workspace name, the configured flag, and the overview excerpt.
 */
export function readMission(mission) {
  const text = String(mission ?? '').replace(/\r\n/g, '\n');
  const line = text.split('\n').find((entry) => /^#\s*Mission\s*[:：]/i.test(entry.trim()));
  const title = line
    ? line
        .trim()
        .replace(/^#\s*Mission\s*[:：]\s*/i, '')
        .replace(/（待配置）/g, '')
        .trim()
    : '';
  const why = (text.match(/##[ \t]*Why[ \t]*\n([\s\S]*?)(?=\n##|$)/i) || [])[1] || '';
  const body = why
    .replace(/^#.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
  const ready = Boolean(body) && !/_待主会话与你确认/.test(why);
  return {
    title,
    why: why.trim(),
    ready,
    // A placeholder is not a mission: never hand it out as the excerpt.
    excerpt: ready ? body : '',
  };
}

export async function loadSnapshot(ws) {
  const root = ws.root;
  const [meta, curriculumRead, annotations, notes, sessions] = await Promise.all([
    readMeta(root),
    readCurriculum(root, { topic: ws.name }),
    readAnnotations(root),
    readNotes(root),
    readSessions(root),
  ]);
  const [mission, resources, lessonFiles, noteFiles, records] = await Promise.all([
    readText(path.join(root, 'MISSION.md'), ''),
    readText(path.join(root, 'RESOURCES.md'), ''),
    listFiles(root, { extensions: ['.html'], max: 400 }),
    listFiles(root, { extensions: ['.md'], max: 200 }),
    listRecords(root),
  ]);

  const curriculum = curriculumRead.curriculum;
  const lessons = allLessons(curriculum);
  // A finished note whose file was deleted must not stay in the list.
  const noteItems = notes.items.filter(
    (item) => item.status !== 'ready' || !item.path || existsSync(resolveInside(root, item.path)),
  );
  const sessionList = Object.values(sessions.sessions)
    .map((session) => sessionSummary(session))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const missionInfo = readMission(mission);
  const displayName = meta?.topic || missionInfo.title || path.basename(root);

  return {
    workspace: {
      id: ws.id,
      name: displayName,
      root,
      createdAt: ws.createdAt ?? 0,
      mainSessionId: meta?.mainSessionId ?? '',
      mainSeededAt: meta?.mainSeededAt ?? 0,
      setupSessionId: meta?.setupSessionId ?? '',
      configured: missionInfo.ready,
    },
    curriculum: {
      modules: curriculum.modules,
      updatedAt: curriculum.updatedAt,
      topic: curriculum.topic,
      issues: curriculum.issues ?? [],
    },
    curriculumError: curriculumRead.error ?? null,
    annotations: annotations.items,
    notes: noteItems,
    sessions: sessionList,
    mission,
    missionTitle: missionInfo.title,
    missionExcerpt: missionInfo.excerpt,
    resources,
    lessonFiles: lessonFiles.filter((rel) => classify(rel).id === 'lesson'),
    noteFiles: noteFiles.filter((rel) => classify(rel).id === 'notes'),
    referenceFiles: lessonFiles.filter((rel) => classify(rel).id === 'reference'),
    records,
    summary: {
      done: lessons.filter((lesson) => lesson.status === 'done').length,
      total: lessons.length,
      annotations: annotations.items.length,
      notes: noteItems.length,
    },
  };
}

export async function readRules(root) {
  return readText(workbenchPaths(root).rules, '');
}

export async function writeContextFile(root, name, body) {
  const file = path.join(workbenchPaths(root).context, `${slugify(name, 'context')}.md`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeText(file, body);
  const rel = toPosix(path.relative(root, file));
  markNodeWrite(root, rel);
  return rel;
}
