import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';

import { resolveInside } from './fsx.mjs';
import { artifactPaths, WORKBENCH_DIR } from './policy.mjs';
import { forgetWorkspace, markClean, reconcileWorkspaceFiles, workspaceId } from './store.mjs';

/**
 * What 「清理产物」 offers, and what each key deletes.
 *
 * Paths come from the artifact table — the clean view owns only the clean
 * semantics: which artifacts form one key, which keys start selected, and which
 * side effects follow a deletion. Callers (the route, the client, the tests)
 * ask this module instead of keeping their own copy of the list.
 */
const dirLabel = (id) => artifactPaths(id)[0] + '/';

const ROWS = [
  { key: 'lessons', ids: ['lesson'], label: dirLabel('lesson'), hint: '课程 HTML', default: true },
  { key: 'reference', ids: ['reference'], label: dirLabel('reference'), hint: '速查文档', default: true },
  { key: 'records', ids: ['records'], label: dirLabel('records'), hint: '学习记录', default: true },
  { key: 'notes', ids: ['notes'], label: dirLabel('notes'), hint: '提炼出的笔记', default: true },
  { key: 'assets', ids: ['assets'], label: dirLabel('assets'), hint: '共享样式 course.css', default: true },
  {
    key: 'docs',
    ids: ['mission', 'resources', 'glossary', 'preferences', 'curriculumDoc'],
    label: 'MISSION / RESOURCES / GLOSSARY / NOTES / CURRICULUM',
    hint: '前置文档',
    default: false,
  },
  {
    key: 'state',
    ids: null,
    label: WORKBENCH_DIR + '/',
    hint: '会话、批注、课纲状态（清理后会从列表移除）',
    default: false,
  },
];

/** The list the client renders and the route validates against. */
export function cleanTargets() {
  return ROWS.map((row) => ({
    key: row.key,
    label: row.label,
    hint: row.hint,
    default: row.default,
    paths: row.ids ? row.ids.flatMap((id) => artifactPaths(id)) : [WORKBENCH_DIR],
  }));
}

/** Unknown keys are dropped, so a stale client cannot delete something else. */
export function cleanKeys(value) {
  const known = new Set(ROWS.map((row) => row.key));
  return Array.isArray(value) ? value.filter((key) => known.has(key)) : [];
}

/**
 * Delete the selected keys and repair what pointed at them.
 * Removing the state directory also removes the workspace from the registry; the
 * caller stops and awaits its running turns first.
 */
export async function cleanWorkspace(root, keys) {
  const wanted = cleanKeys(keys);
  const rows = cleanTargets().filter((item) => wanted.includes(item.key));
  // Claim the paths before the first rm: a turn that is still winding down must
  // not restore them or write the state directory back.
  markClean(root, { keys: wanted, paths: rows.flatMap((row) => row.paths) });
  const removed = [];
  for (const row of rows) {
    for (const rel of row.paths) {
      const absolute = resolveInside(root, rel);
      if (!existsSync(absolute)) continue;
      await rm(absolute, { recursive: true, force: true });
      removed.push(rel);
    }
  }

  const workspaceGone = wanted.includes('state');
  const effects = { notesPruned: 0, lessonsReset: 0 };

  if (workspaceGone) {
    await forgetWorkspace(workspaceId(root));
    // Sweep once more: a turn that outlived the abort may have written the state
    // directory back between the delete and the forget.
    await rm(resolveInside(root, WORKBENCH_DIR), { recursive: true, force: true });
    return { removed, workspaceGone, effects };
  }

  const reconciled = await reconcileWorkspaceFiles(root, {
    lessons: wanted.includes('lessons'),
    notes: wanted.includes('notes'),
  });
  effects.notesPruned = reconciled.notesPruned;
  effects.lessonsReset = reconciled.lessonsReset;

  return { removed, workspaceGone, effects };
}
