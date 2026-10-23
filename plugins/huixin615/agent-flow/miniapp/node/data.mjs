// Read-only adapter for the local runtime layout observed in MiniMax Code 3.1.4.
import { readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';

const SESSION_ID = /^mvs_[a-zA-Z0-9]+$/;
const TASK_ID = /^bg_[a-zA-Z0-9-]+$/;
const RELATIVE_DIR = /^20\d{2}\/\d{2}\/\d{2}\/[a-zA-Z0-9_-]+-session_[a-zA-Z0-9_-]+$/;
const MAX_HISTORY_BYTES = 8 * 1024 * 1024;
const MAX_TREE_TASKS = 2000;
const MAX_TREE_DEPTH = 8;
const HISTORY_CACHE_SIZE = 8;
const historyCache = new Map();
const parentEvidenceCache = new WeakMap();

function timestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export class DataError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function dataHome(env = process.env) {
  return typeof env.MAVIS_HOME === 'string' && env.MAVIS_HOME.trim()
    ? resolve(env.MAVIS_HOME.trim())
    : join(homedir(), '.minimax');
}

async function withDb(home, use) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    throw new DataError('SQLITE_UNAVAILABLE', '当前 Node 运行时无法读取本机会话数据库。');
  }
  let db;
  try {
    db = new DatabaseSync(join(home, 'v2', 'sqlite', 'runtime-state.sqlite'), { readOnly: true });
    return use(db);
  } catch (error) {
    if (error instanceof DataError) throw error;
    throw new DataError('STORE_UNAVAILABLE', '本机会话数据库不可用或格式不兼容。');
  } finally {
    db?.close();
  }
}

function sessionRow(db, id) {
  return db.prepare(`
    SELECT session_id AS id, parent_session_id AS parentId, session_kind AS kind,
      title, status, created_at_ms AS createdAt, updated_at_ms AS updatedAt,
      history_relative_dir AS historyDir
    FROM local_runtime_sessions
    WHERE session_id = ?
  `).get(id);
}

export async function listConversations(home = dataHome(), limit = 40, pinnedId = null) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000) {
    throw new DataError('INVALID_LIMIT', '会话列表数量无效。');
  }
  if (pinnedId !== null && !SESSION_ID.test(pinnedId)) {
    throw new DataError('INVALID_SESSION', '会话 ID 格式无效。');
  }
  const { rows, pinned } = await withDb(home, (db) => {
    const rows = db.prepare(`
    SELECT s.session_id AS id, s.title, s.status,
      s.created_at_ms AS createdAt, s.updated_at_ms AS updatedAt,
      (SELECT COUNT(*) FROM local_runtime_background_tasks t
        WHERE t.kind = 'subagent' AND t.owner_session_id = s.session_id) AS taskCount
    FROM local_runtime_sessions s
    WHERE s.session_kind = 'conversation' AND s.parent_session_id IS NULL
    ORDER BY s.updated_at_ms DESC
    LIMIT ?
  `).all(limit + 1);
    let pinned = null;
    if (pinnedId && !rows.some((row) => row.id === pinnedId)) {
      const session = sessionRow(db, pinnedId);
      if (session?.kind === 'conversation' && session.parentId === null) {
        const count = db.prepare(`SELECT COUNT(*) AS count FROM local_runtime_background_tasks
          WHERE kind = 'subagent' AND owner_session_id = ?`).get(pinnedId).count;
        pinned = { id: session.id, title: session.title, status: session.status,
          createdAt: session.createdAt, updatedAt: session.updatedAt, taskCount: count };
      }
    }
    return { rows, pinned };
  });
  const sessions = rows.slice(0, limit).filter((row) => SESSION_ID.test(row.id))
    .map((row) => ({ ...row, title: row.title || '未命名会话' }));
  if (pinned && !sessions.some((row) => row.id === pinned.id)) {
    sessions.push({ ...pinned, title: pinned.title || '未命名会话' });
  }
  return {
    sessions,
    hasMore: rows.length > limit,
  };
}

export function parseTaskRow(raw) {
  let record;
  try { record = JSON.parse(raw); } catch { return null; }
  if (record?.kind !== 'subagent' || !TASK_ID.test(record.taskId) || !SESSION_ID.test(record.ownerSessionId)) return null;
  const meta = record.metadata ?? {};
  const childId = typeof meta.childSessionId === 'string' && SESSION_ID.test(meta.childSessionId) ? meta.childSessionId : null;
  const task = {
    id: record.taskId,
    ownerId: record.ownerSessionId,
    childId,
    parentTurnId: typeof meta.parentTurnId === 'string' ? meta.parentTurnId : null,
    toolCallId: typeof record.toolCallId === 'string' ? record.toolCallId : null,
    name: typeof record.description === 'string' ? record.description : '未命名委派',
    agent: typeof meta.agentName === 'string' ? meta.agentName : '未知 Agent',
    mode: typeof meta.executionMode === 'string' ? meta.executionMode : '未知',
    status: typeof record.status === 'string' ? record.status : 'unknown',
    createdAt: timestamp(record.createdAt),
    startedAt: timestamp(record.startedAt),
    endedAt: timestamp(record.endedAt),
    deliveredAt: timestamp(record.deliveredAt),
    updatedAt: timestamp(record.updatedAt),
  };
  if (typeof meta.parentSessionId === 'string' && meta.parentSessionId !== task.ownerId) {
    task.warning = '任务记录中的父会话 ID 不一致';
    task.childId = null;
  }
  return task;
}

function loadTaskTree(db, rootId) {
  const root = sessionRow(db, rootId);
  if (!root || root.kind !== 'conversation' || root.parentId !== null) {
    throw new DataError('SESSION_NOT_FOUND', '没有找到这条本机会话。');
  }
  const sessions = new Map([[rootId, root]]);
  const tasks = [];
  const seen = new Set([rootId]);
  const parentTasks = new Map();
  let frontier = [rootId];
  const byOwner = db.prepare(`SELECT record_json FROM local_runtime_background_tasks
    WHERE kind = 'subagent' AND owner_session_id = ? ORDER BY created_at_ms ASC LIMIT ?`);
  for (let depth = 0; frontier.length; depth += 1) {
    const next = [];
    for (const ownerId of frontier) {
      const rows = byOwner.all(ownerId, MAX_TREE_TASKS + 1);
      if (depth === MAX_TREE_DEPTH && rows.length) {
        throw new DataError('TASK_DEPTH_LIMIT', '子 Agent 嵌套超过当前支持的层数，无法完整展示。');
      }
      for (const row of rows) {
        const task = parseTaskRow(row.record_json);
        if (!task || task.ownerId !== ownerId) {
          throw new DataError('TASK_RECORD_INVALID', '子任务记录与所属会话不一致或格式不兼容。');
        }
        task.depth = depth;
        task.parentTaskId = parentTasks.get(ownerId) ?? null;
        tasks.push(task);
        if (tasks.length > MAX_TREE_TASKS) {
          throw new DataError('TASK_LIMIT', '当前会话的子任务过多，无法完整展示。');
        }
        if (!task.childId) continue;
        const child = sessions.get(task.childId) ?? sessionRow(db, task.childId);
        if (!child) {
          task.warning = '子会话索引尚未出现，等待刷新';
          continue;
        }
        if (child.kind !== 'task' || child.parentId !== ownerId) {
          task.warning = '子会话的父会话与任务记录不一致';
          task.childId = null;
          continue;
        }
        if (parentTasks.has(child.id) && parentTasks.get(child.id) !== task.id) {
          task.warning = '同一子会话关联了多项任务，关系无法核实';
          task.childId = null;
          continue;
        }
        sessions.set(child.id, child);
        if (!seen.has(child.id)) {
          seen.add(child.id);
          parentTasks.set(child.id, task.id);
          next.push(child.id);
        }
      }
    }
    frontier = next;
  }
  return { root, sessions, tasks: tasks.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)) };
}

async function historyRows(home, session) {
  if (!session || !SESSION_ID.test(session.id) || typeof session.historyDir !== 'string' || !RELATIVE_DIR.test(session.historyDir)) {
    throw new DataError('HISTORY_PATH_INVALID', '会话历史路径格式不符合已验证版本。');
  }
  const token = session.historyDir.split('-session_').at(-1);
  if (token !== Buffer.from(session.id, 'utf8').toString('base64url')) {
    throw new DataError('HISTORY_PATH_INVALID', '会话历史目录与会话 ID 不一致。');
  }
  const root = await realpath(resolve(home, 'v2', 'sessions'));
  const file = resolve(root, session.historyDir, 'messages.jsonl');
  if (!file.startsWith(root + sep) || relative(root, file).startsWith('..')) {
    throw new DataError('HISTORY_PATH_INVALID', '会话历史路径超出本机会话目录。');
  }
  const actual = await realpath(file);
  if (!actual.startsWith(root + sep)) throw new DataError('HISTORY_PATH_INVALID', '会话历史文件指向目录外。');
  if (actual !== file) throw new DataError('HISTORY_PATH_INVALID', '会话历史路径包含未验证的符号链接。');
  const info = await stat(actual);
  if (info.size > MAX_HISTORY_BYTES) throw new DataError('HISTORY_TOO_LARGE', '会话历史较大，暂不加载消息详情。');
  const cached = historyCache.get(actual);
  if (cached?.size === info.size && cached?.mtimeMs === info.mtimeMs) {
    historyCache.delete(actual);
    historyCache.set(actual, cached);
    return cached.rows;
  }
  const raw = await readFile(actual, 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  if (lines.length > 4000) throw new DataError('HISTORY_TOO_LARGE', '会话消息过多，暂不加载详情。');
  const rows = lines.map((line) => {
    try { return JSON.parse(line); }
    catch { throw new DataError('HISTORY_INVALID', '会话历史包含不完整或损坏的记录。'); }
  });
  historyCache.delete(actual);
  historyCache.set(actual, { size: info.size, mtimeMs: info.mtimeMs, rows });
  if (historyCache.size > HISTORY_CACHE_SIZE) historyCache.delete(historyCache.keys().next().value);
  return rows;
}

function plainText(message) {
  if (!Array.isArray(message?.content)) return '';
  return message.content.filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text).join('\n');
}

export function extractTaskEvidence(parentRows, childRows, toolCallId) {
  const { instruction, parentResult } = parentEvidenceByCall(parentRows).get(toolCallId)
    ?? { instruction: '', parentResult: false };
  let finalText = '';
  const tools = [];
  for (const row of childRows) {
    const message = row?.message;
    if (message?.role !== 'assistant') continue;
    const calls = Array.isArray(message.content)
      ? message.content.filter((part) => part?.type === 'toolCall' && typeof part.name === 'string') : [];
    for (const call of calls) tools.push(call.name);
  }
  const last = childRows.at(-1)?.message;
  if (last?.role === 'assistant' && !last.content?.some?.((part) => part?.type === 'toolCall')) {
    finalText = plainText(last);
  }
  return { instruction, finalText, parentResult, tools };
}

function parentEvidenceByCall(rows) {
  if (parentEvidenceCache.has(rows)) return parentEvidenceCache.get(rows);
  const calls = new Map();
  for (const row of rows) {
    const message = row?.message;
    if (message?.role === 'assistant' && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part?.type === 'toolCall' && part.name === 'task' && typeof part.id === 'string') {
          calls.set(part.id, {
            instruction: typeof part.arguments?.prompt === 'string' ? part.arguments.prompt : '',
            parentResult: calls.get(part.id)?.parentResult ?? false,
          });
        }
      }
    }
    if (message?.role === 'toolResult' && message.toolName === 'task' && typeof message.toolCallId === 'string') {
      const entry = calls.get(message.toolCallId) ?? { instruction: '', parentResult: false };
      entry.parentResult = true;
      calls.set(message.toolCallId, entry);
    }
  }
  parentEvidenceCache.set(rows, calls);
  return calls;
}

export function analyzeExecution(tasks) {
  const groups = new Map();
  for (const task of tasks) {
    if (!task.parentTurnId) continue;
    const key = `${task.ownerId}:${task.parentTurnId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(task);
  }
  const sameTurnGroups = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const intervals = group.map((task) => [task.startedAt, task.endedAt]);
    const complete = intervals.every(([start, end]) =>
      Number.isFinite(start) && Number.isFinite(end) && start > 0 && end >= start);
    if (!complete) {
      sameTurnGroups.push({ count: group.length, execution: 'incomplete' });
      continue;
    }
    intervals.sort((a, b) => a[0] - b[0]);
    let latestEnd = 0;
    let overlap = false;
    for (const [start, end] of intervals) {
      if (start < latestEnd) overlap = true;
      latestEnd = Math.max(latestEnd, end);
    }
    sameTurnGroups.push({
      count: group.length,
      execution: overlap ? 'overlap' : 'serial',
      wallMs: latestEnd - intervals[0][0],
    });
  }
  return {
    sameTurnGroups,
    parentResults: tasks.filter((task) => task.parentResult).length,
    delivered: tasks.filter((task) => task.deliveredAt).length,
  };
}

export async function readFlow(rootId, home = dataHome()) {
  if (!SESSION_ID.test(rootId)) throw new DataError('INVALID_SESSION', '会话 ID 格式无效。');
  const { root, sessions, tasks } = await withDb(home, (db) => loadTaskTree(db, rootId));
  const parentEvidence = new Map();
  const historyError = new Map();
  for (const id of new Set(tasks.map((task) => task.ownerId))) {
    try { parentEvidence.set(id, parentEvidenceByCall(await historyRows(home, sessions.get(id)))); }
    catch (error) { historyError.set(id, error instanceof DataError ? error.message : '会话历史暂不可读。'); }
  }
  const enriched = tasks.map((task) => {
    const evidence = parentEvidence.get(task.ownerId)?.get(task.toolCallId) ?? { instruction: '', parentResult: false };
    const parentState = evidence.parentResult ? 'matched'
      : historyError.has(task.ownerId) ? 'unreadable'
        : task.deliveredAt ? 'unverified' : 'pending';
    return {
      ...task,
      instruction: evidence.instruction,
      parentResult: evidence.parentResult,
      parentState,
      historyWarning: historyError.get(task.ownerId) || null,
    };
  });
  return {
    session: { id: root.id, title: root.title || '未命名会话', updatedAt: root.updatedAt },
    observedAt: Date.now(),
    tasks: enriched,
    analysis: analyzeExecution(enriched),
  };
}

export async function readTaskDetail(rootId, taskId, home = dataHome()) {
  if (!TASK_ID.test(taskId)) throw new DataError('INVALID_TASK', '任务 ID 格式无效。');
  const flow = await readFlow(rootId, home);
  const task = flow.tasks.find((item) => item.id === taskId);
  if (!task) throw new DataError('TASK_NOT_FOUND', '所选会话中没有这项子任务。');
  if (!task.childId) return { ...task, finalText: '', tools: [] };
  const child = await withDb(home, (db) => db.prepare(`SELECT session_id AS id,
    parent_session_id AS parentId, session_kind AS kind, history_relative_dir AS historyDir
    FROM local_runtime_sessions WHERE session_id = ?`).get(task.childId));
  if (!child || child.kind !== 'task' || child.parentId !== task.ownerId) {
    return { ...task, finalText: '', tools: [], warning: '子会话记录暂不可用或关联不一致' };
  }
  try {
    const rows = await historyRows(home, child);
    const evidence = extractTaskEvidence([], rows, null);
    return { ...task, finalText: evidence.finalText, tools: evidence.tools };
  } catch (error) {
    return { ...task, finalText: '', tools: [], historyWarning: error instanceof DataError ? error.message : '子会话历史暂不可读。' };
  }
}
