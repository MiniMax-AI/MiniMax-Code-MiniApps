/**
 * One declaration of every workspace artifact and who may write it.
 *
 * This module is the single source for four things that used to drift apart:
 *   1. which session kind may write a path (the seam decision),
 *   2. the explanation shown when a write is refused,
 *   3. the contract text in .workbench/rules/teach.md and the prompts,
 *   4. which files a turn snapshots so an out-of-scope write can be restored.
 *
 * Pure on purpose: no fs access, no session state beyond the lesson's own
 * target file. Every function here is a table lookup, so the whole policy is
 * testable as a matrix of (kind, rel) pairs.
 */

import path from 'node:path';

/** Every directory and file name a workspace uses, declared once. */
export const WORKBENCH_DIR = '.workbench';
export const RULES_DIR = `${WORKBENCH_DIR}/rules`;
export const COURSE_CSS_REL = 'assets/course.css';

/** Workspace-relative state paths. */
export const STATE_RELS = {
  meta: `${WORKBENCH_DIR}/workspace.json`,
  sessions: `${WORKBENCH_DIR}/sessions.json`,
  annotations: `${WORKBENCH_DIR}/annotations.json`,
  notes: `${WORKBENCH_DIR}/notes.json`,
  curriculum: `${WORKBENCH_DIR}/curriculum.json`,
  curriculumBackup: `${WORKBENCH_DIR}/curriculum.backup.json`,
  rules: `${RULES_DIR}/teach.md`,
  context: `${WORKBENCH_DIR}/context`,
};

/** Absolute paths for one workspace root; the only builder callers use. */
export function workbenchPaths(root) {
  return {
    base: path.join(root, WORKBENCH_DIR),
    meta: path.join(root, STATE_RELS.meta),
    curriculum: path.join(root, STATE_RELS.curriculum),
    curriculumBackup: path.join(root, STATE_RELS.curriculumBackup),
    annotations: path.join(root, STATE_RELS.annotations),
    notes: path.join(root, STATE_RELS.notes),
    sessions: path.join(root, STATE_RELS.sessions),
    context: path.join(root, STATE_RELS.context),
    rules: path.join(root, STATE_RELS.rules),
  };
}

export function rulesPath(root) {
  return path.join(root, STATE_RELS.rules);
}

export const SESSION_KINDS = ['main', 'setup', 'lesson', 'note'];

export const KIND_LABEL = {
  main: '主会话',
  setup: '配置会话',
  lesson: '课程分支会话',
  note: '提炼会话',
};

/**
 * Ordered: the first spec whose files/dirs match owns the path.
 * "other" is the fallback for everything the workspace does not own.
 */
export const ARTIFACTS = [
  { id: 'mission', label: '使命', mention: '`MISSION.md`', files: ['MISSION.md'], writers: ['main', 'setup'] },
  { id: 'resources', label: '来源清单', mention: '`RESOURCES.md`', files: ['RESOURCES.md'], writers: ['main', 'setup'] },
  { id: 'glossary', label: '术语表', mention: '`GLOSSARY.md`', files: ['GLOSSARY.md'], writers: ['main', 'setup'] },
  { id: 'preferences', label: '教学偏好', mention: '`NOTES.md`', files: ['NOTES.md'], writers: ['main', 'setup'] },
  { id: 'curriculumDoc', label: '课纲文档', mention: '`CURRICULUM.md`', files: ['CURRICULUM.md'], writers: ['main'] },
  { id: 'curriculumState', label: '课纲状态', mention: '`.workbench/curriculum.json`', files: [STATE_RELS.curriculum], writers: ['main'] },
  { id: 'contextPacket', label: '上下文包', mention: '`.workbench/context/`', dirs: [{ dir: STATE_RELS.context }], writers: ['main'] },
  {
    id: 'appState',
    label: '应用状态',
    mention: '`.workbench/` 下的会话、批注、笔记索引',
    files: [
      STATE_RELS.meta,
      STATE_RELS.sessions,
      STATE_RELS.annotations,
      STATE_RELS.notes,
      STATE_RELS.curriculumBackup,
    ],
    writers: [],
  },
  { id: 'lesson', label: '课程', mention: '`lessons/*.html`', dirs: [{ dir: 'lessons', exts: ['.html'], own: true }], writers: ['lesson'] },
  { id: 'reference', label: '速查文档', mention: '`reference/`', dirs: [{ dir: 'reference' }], writers: ['main', 'lesson', 'note'] },
  { id: 'records', label: '学习记录', mention: '`learning-records/`', dirs: [{ dir: 'learning-records' }], writers: ['lesson'] },
  { id: 'notes', label: '提炼笔记', mention: '`notes/`', dirs: [{ dir: 'notes' }], writers: ['note'] },
  { id: 'assets', label: '共享样式', mention: '`assets/`', dirs: [{ dir: 'assets' }], writers: ['main', 'lesson'] },
  { id: 'other', label: '其他文件', mention: '工作区里的其他文件', writers: ['main'], neverProtect: true },
];

const OTHER = ARTIFACTS[ARTIFACTS.length - 1];

export function toPosixRel(rel) {
  return String(rel ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
}

/**
 * True when `rel` is one of `paths` or lives inside one of those directories.
 * Cleaned roots are declared without a trailing slash (lessons), so a plain
 * prefix test would also match a sibling such as lessons-old.
 */
export function underAny(rel, paths) {
  const posix = toPosixRel(rel);
  return (paths ?? []).some((item) => {
    const root = toPosixRel(item);
    return Boolean(root) && (posix === root || posix.startsWith(`${root}/`));
  });
}

function matches(spec, posix) {
  if (spec.files) return spec.files.includes(posix);
  if (spec.dirs) {
    return spec.dirs.some((entry) => posix === entry.dir || posix.startsWith(`${entry.dir}/`));
  }
  return false;
}

export function classify(rel) {
  const posix = toPosixRel(rel);
  return ARTIFACTS.find((spec) => matches(spec, posix)) ?? OTHER;
}

/** Relative paths that belong to one artifact: its files and directory roots. */
export function artifactPaths(id) {
  const spec = ARTIFACTS.find((item) => item.id === id);
  if (!spec) return [];
  const out = [];
  if (spec.files) out.push(...spec.files);
  if (spec.dirs) for (const entry of spec.dirs) out.push(entry.dir);
  return out;
}

/** The one place that decides whether a session may write a path. */
export function canWrite(kind, rel, session = {}) {
  const posix = toPosixRel(rel);
  const spec = classify(posix);
  if (!spec.writers.includes(kind)) return false;
  if (spec.id === 'lesson' && kind === 'lesson') return posix === toPosixRel(session.targetFile);
  return true;
}

/** The one place that explains a refusal. */
export function denyMessage(kind, rel, session = {}) {
  const posix = toPosixRel(rel);
  const spec = classify(posix);
  const who = KIND_LABEL[kind] ?? '这个会话';
  if (spec.id === 'lesson' && kind === 'lesson') {
    return `已阻止修改其他课程（${posix}）：课程会话只能写自己的 ${session.targetFile || '本课文件'}。`;
  }
  const owners = spec.writers.map((item) => KIND_LABEL[item]).join(' 或 ');
  return owners
    ? `已阻止${who}写 ${posix}：${spec.label}只能由${owners}维护。`
    : `已阻止${who}写 ${posix}：${spec.label}由应用维护，会话不写。`;
}

/** Artifacts this kind must not write, so a turn snapshots them for restore. */
export function protectedSpecs(kind) {
  const files = [];
  const dirs = [];
  for (const spec of ARTIFACTS) {
    if (spec.neverProtect) continue;
    // A kind that owns one file inside a shared directory (the lesson's own
    // HTML) still needs the rest of that directory snapshotted.
    const ownsOne = Boolean(spec.dirs && spec.dirs.some((entry) => entry.own));
    if (spec.writers.includes(kind) && !ownsOne) continue;
    if (spec.files) files.push(...spec.files);
    if (spec.dirs) for (const entry of spec.dirs) dirs.push({ ...entry });
  }
  return { files, dirs };
}

function mentionFor(kind, spec) {
  if (spec.id === 'lesson' && kind === 'lesson') return '`lessons/<本课文件>`';
  return spec.mention;
}

/** Hard-boundary bullets for .workbench/rules/teach.md. */
export function boundaryLines() {
  return SESSION_KINDS.map((kind) => {
    const can = ARTIFACTS.filter((spec) => spec.writers.includes(kind)).map((spec) => mentionFor(kind, spec));
    const cannot = ARTIFACTS.filter((spec) => !spec.writers.includes(kind)).map((spec) => spec.mention);
    return `- **${KIND_LABEL[kind]}**：可写 ${can.join('、') || '无'}；不可写 ${cannot.join('、')}。`;
  }).join('\n');
}

/** Short scope lines for prompts: what this turn may touch, and what it may not. */
export function scopeLines(kind) {
  const can = ARTIFACTS.filter((spec) => spec.writers.includes(kind)).map((spec) => mentionFor(kind, spec));
  const cannot = ARTIFACTS.filter((spec) => !spec.writers.includes(kind)).map((spec) => spec.mention);
  return `可以写：${can.join('、') || '无'}。\n禁止改动：${cannot.join('、')}。`;
}
