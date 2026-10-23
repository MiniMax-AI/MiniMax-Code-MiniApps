import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { analyzeExecution, extractTaskEvidence, listConversations, readFlow, readTaskDetail } from '../miniapp/node/data.mjs';

const parentId = 'mvs_parent';
const childId = 'mvs_child';
const parentDir = `2026/10/24/00-00-00-000-session_${Buffer.from(parentId).toString('base64url')}`;
const childDir = `2026/10/24/00-00-01-000-session_${Buffer.from(childId).toString('base64url')}`;

async function fixture({ badPath = false, childParent = parentId, newerIdle = false } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'agent-flow-'));
  await mkdir(join(home, 'v2', 'sqlite'), { recursive: true });
  const db = new DatabaseSync(join(home, 'v2', 'sqlite', 'runtime-state.sqlite'));
  db.exec(`CREATE TABLE local_runtime_sessions (
    session_id TEXT, parent_session_id TEXT, session_kind TEXT, title TEXT,
    status TEXT, created_at_ms INTEGER, updated_at_ms INTEGER, history_relative_dir TEXT);
    CREATE TABLE local_runtime_background_tasks (
      kind TEXT, owner_session_id TEXT, created_at_ms INTEGER, record_json TEXT);`);
  const insertSession = db.prepare('INSERT INTO local_runtime_sessions VALUES (?,?,?,?,?,?,?,?)');
  insertSession.run(parentId, null, 'conversation', 'Demo parent', 'idle', 100, 200, badPath ? '../outside' : parentDir);
  insertSession.run(childId, childParent, 'task', 'Demo child', 'idle', 110, 190, childDir);
  if (newerIdle) insertSession.run('mvs_newer', null, 'conversation', 'Newer empty chat', 'idle', 300, 400, parentDir);
  const task = {
    taskId: 'bg_1', kind: 'subagent', status: 'succeeded', ownerSessionId: parentId,
    description: 'Read a file', toolCallId: 'call_1', createdAt: 110, startedAt: 120,
    endedAt: 190, deliveredAt: 191,
    metadata: { parentSessionId: parentId, parentTurnId: 'turn_1', childSessionId: childId,
      agentName: 'explore', executionMode: 'foreground' },
  };
  db.prepare('INSERT INTO local_runtime_background_tasks VALUES (?,?,?,?)').run('subagent', parentId, 110, JSON.stringify(task));
  db.close();
  const writeHistory = async (rel, rows) => {
    const dir = join(home, 'v2', 'sessions', rel);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'messages.jsonl'), rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  };
  if (!badPath) await writeHistory(parentDir, [
    { message: { role: 'assistant', content: [{ type: 'toolCall', name: 'task', id: 'call_1', arguments: { prompt: 'Read README only' } }] } },
    { message: { role: 'toolResult', toolName: 'task', toolCallId: 'call_1', content: [{ type: 'text', text: 'Done: README describes the project.' }] } },
  ]);
  await writeHistory(childDir, [
    { message: { role: 'user', content: [{ type: 'text', text: '<system-reminder>host text</system-reminder>' }] } },
    { message: { role: 'assistant', content: [{ type: 'toolCall', name: 'read', id: 'read_1', arguments: {} }] } },
    { message: { role: 'assistant', content: [{ type: 'text', text: 'README describes the project.' }] } },
  ]);
  return { home, cleanup: () => rm(home, { recursive: true, force: true }) };
}

test('links task, child session, parent tool result and child final reply', async () => {
  const f = await fixture();
  try {
    const { sessions } = await listConversations(f.home);
    assert.deepEqual(sessions.map((session) => session.id), [parentId]);
    const flow = await readFlow(parentId, f.home);
    assert.equal(flow.tasks.length, 1);
    const task = flow.tasks[0];
    assert.equal(task.childId, childId);
    assert.equal(task.parentResult, true);
    assert.equal(task.parentState, 'matched');
    assert.equal(task.instruction, 'Read README only');
    assert.equal(task.finalText, undefined);
    const detail = await readTaskDetail(parentId, 'bg_1', f.home);
    assert.equal(detail.finalText, 'README describes the project.');
    assert.deepEqual(detail.tools, ['read']);
    assert.equal(task.deliveredAt, 191);
  } finally { await f.cleanup(); }
});

test('older task and conversation remain visible beyond former global caps', async () => {
  const f = await fixture();
  try {
    const db = new DatabaseSync(join(f.home, 'v2', 'sqlite', 'runtime-state.sqlite'));
    const addSession = db.prepare('INSERT INTO local_runtime_sessions VALUES (?,?,?,?,?,?,?,?)');
    const addTask = db.prepare('INSERT INTO local_runtime_background_tasks VALUES (?,?,?,?)');
    db.exec('BEGIN');
    for (let i = 0; i < 1201; i += 1) {
      addSession.run(`mvs_idle${i}`, null, 'conversation', 'Idle', 'idle', 1000 + i, 1000 + i, parentDir);
      addTask.run('subagent', 'mvs_noise', 1000 + i, JSON.stringify({
        kind: 'subagent', taskId: `bg_noise${i}`, ownerSessionId: 'mvs_noise',
        createdAt: 1000 + i,
      }));
    }
    db.exec('COMMIT');
    db.close();
    const firstPage = await listConversations(f.home);
    assert.equal(firstPage.sessions[0].id, 'mvs_idle1200');
    assert.equal(firstPage.hasMore, true);
    assert.equal((await listConversations(f.home, 1240)).sessions.some(({ id }) => id === parentId), true);
    assert.equal((await readFlow(parentId, f.home)).tasks.length, 1);
  } finally { await f.cleanup(); }
});

test('session picker can request later pages instead of silently hiding task-bearing chats', async () => {
  const f = await fixture();
  try {
    const db = new DatabaseSync(join(f.home, 'v2', 'sqlite', 'runtime-state.sqlite'));
    const addSession = db.prepare('INSERT INTO local_runtime_sessions VALUES (?,?,?,?,?,?,?,?)');
    const addTask = db.prepare('INSERT INTO local_runtime_background_tasks VALUES (?,?,?,?)');
    db.exec('BEGIN');
    for (let i = 0; i < 45; i += 1) {
      const id = `mvs_recent${i}`;
      addSession.run(id, null, 'conversation', 'Recent', 'idle', 1000 + i, 1000 + i, parentDir);
      addTask.run('subagent', id, 1000 + i, JSON.stringify({
        kind: 'subagent', taskId: `bg_recent${i}`, ownerSessionId: id, createdAt: 1000 + i,
      }));
    }
    db.exec('COMMIT');
    db.close();
    const firstPage = await listConversations(f.home);
    assert.equal(firstPage.sessions.length, 40);
    assert.equal(firstPage.hasMore, true);
    assert.equal(firstPage.sessions.some(({ id }) => id === parentId), false);
    const pinned = await listConversations(f.home, 40, parentId);
    assert.equal(pinned.sessions.at(-1).id, parentId);
    const expanded = await listConversations(f.home, 80);
    assert.equal(expanded.sessions.some(({ id }) => id === parentId), true);
    assert.equal(expanded.hasMore, false);
  } finally { await f.cleanup(); }
});

test('rejects a valid-looking history path belonging to another session', async () => {
  const f = await fixture();
  try {
    const db = new DatabaseSync(join(f.home, 'v2', 'sqlite', 'runtime-state.sqlite'));
    db.prepare('UPDATE local_runtime_sessions SET history_relative_dir = ? WHERE session_id = ?').run(parentDir, childId);
    db.close();
    const detail = await readTaskDetail(parentId, 'bg_1', f.home);
    assert.equal(detail.finalText, '');
    assert.match(detail.historyWarning, /会话 ID 不一致/);
  } finally { await f.cleanup(); }
});

test('rejects a history symlink even when its target stays under the sessions root', async () => {
  const f = await fixture();
  try {
    const childFile = join(f.home, 'v2', 'sessions', childDir, 'messages.jsonl');
    await rm(childFile);
    await symlink(join(f.home, 'v2', 'sessions', parentDir, 'messages.jsonl'), childFile);
    const detail = await readTaskDetail(parentId, 'bg_1', f.home);
    assert.equal(detail.finalText, '');
    assert.match(detail.historyWarning, /符号链接/);
  } finally { await f.cleanup(); }
});

test('marks a delivered result unverified when active parent history no longer contains it', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.home, 'v2', 'sessions', parentDir, 'messages.jsonl'),
      JSON.stringify({ message: { role: 'assistant', content: [{ type: 'text', text: 'Later summary' }] } }) + '\n');
    const task = (await readFlow(parentId, f.home)).tasks[0];
    assert.equal(task.parentResult, false);
    assert.equal(task.parentState, 'unverified');
    assert.equal(task.deliveredAt, 191);
  } finally { await f.cleanup(); }
});

test('links a nested failed background task to its parent task', async () => {
  const f = await fixture();
  try {
    const grandchildId = 'mvs_grandchild';
    const grandchildDir = `2026/10/24/00-00-02-000-session_${Buffer.from(grandchildId).toString('base64url')}`;
    const db = new DatabaseSync(join(f.home, 'v2', 'sqlite', 'runtime-state.sqlite'));
    db.prepare('INSERT INTO local_runtime_sessions VALUES (?,?,?,?,?,?,?,?)')
      .run(grandchildId, childId, 'task', 'Nested child', 'idle', 125, 185, grandchildDir);
    db.prepare('INSERT INTO local_runtime_background_tasks VALUES (?,?,?,?)')
      .run('subagent', childId, 125, JSON.stringify({
        kind: 'subagent', taskId: 'bg_nested', ownerSessionId: childId,
        status: 'failed', description: 'Read nested file', toolCallId: 'call_nested',
        createdAt: 125, startedAt: 130, endedAt: 180, deliveredAt: 181,
        metadata: { parentSessionId: childId, parentTurnId: 'turn_nested',
          childSessionId: grandchildId, executionMode: 'background', agentName: 'explore' },
      }));
    db.close();
    await writeFile(join(f.home, 'v2', 'sessions', childDir, 'messages.jsonl'), [
      { message: { role: 'assistant', content: [{ type: 'toolCall', name: 'task', id: 'call_nested', arguments: { prompt: 'Inspect nested file' } }] } },
      { message: { role: 'toolResult', toolName: 'task', toolCallId: 'call_nested', content: [{ type: 'text', text: 'Task failed' }] } },
      { message: { role: 'assistant', content: [{ type: 'text', text: 'Nested task failed.' }] } },
    ].map((row) => JSON.stringify(row)).join('\n') + '\n');
    await mkdir(join(f.home, 'v2', 'sessions', grandchildDir), { recursive: true });
    await writeFile(join(f.home, 'v2', 'sessions', grandchildDir, 'messages.jsonl'),
      JSON.stringify({ message: { role: 'assistant', content: [{ type: 'text', text: 'Could not read file.' }] } }) + '\n');
    const flow = await readFlow(parentId, f.home);
    const nested = flow.tasks.find(({ id }) => id === 'bg_nested');
    assert.equal(flow.tasks.length, 2);
    assert.equal(nested.depth, 1);
    assert.equal(nested.parentTaskId, 'bg_1');
    assert.equal(nested.mode, 'background');
    assert.equal(nested.status, 'failed');
    assert.equal(nested.parentState, 'matched');
    assert.equal((await readTaskDetail(parentId, nested.id, f.home)).finalText, 'Could not read file.');
  } finally { await f.cleanup(); }
});

test('defaults to the newest conversation even before it has sub-agent tasks', async () => {
  const f = await fixture({ newerIdle: true });
  try {
    const { sessions } = await listConversations(f.home);
    assert.deepEqual(sessions.map(({ id, taskCount }) => [id, taskCount]),
      [['mvs_newer', 0], [parentId, 1]]);
    assert.deepEqual((await readFlow('mvs_newer', f.home)).tasks, []);
  } finally { await f.cleanup(); }
});

test('rejects a child whose parent link contradicts the task record', async () => {
  const f = await fixture({ childParent: 'mvs_other' });
  try {
    const [selected] = (await readFlow(parentId, f.home)).tasks;
    assert.equal(selected.childId, null);
    assert.match(selected.warning, /不一致/);
  } finally { await f.cleanup(); }
});

test('does not attribute one child session to two different task records', async () => {
  const f = await fixture();
  try {
    const db = new DatabaseSync(join(f.home, 'v2', 'sqlite', 'runtime-state.sqlite'));
    db.prepare('INSERT INTO local_runtime_background_tasks VALUES (?,?,?,?)').run('subagent', parentId, 115,
      JSON.stringify({ kind: 'subagent', taskId: 'bg_second', ownerSessionId: parentId,
        createdAt: 115, metadata: { childSessionId: childId, parentSessionId: parentId } }));
    db.close();
    const tasks = (await readFlow(parentId, f.home)).tasks;
    assert.equal(tasks[0].childId, childId);
    assert.equal(tasks[1].childId, null);
    assert.match(tasks[1].warning, /多项任务/);
  } finally { await f.cleanup(); }
});

test('does not open a history path outside the session directory', async () => {
  const f = await fixture({ badPath: true });
  try {
    const flow = await readFlow(parentId, f.home);
    assert.match(flow.tasks[0].historyWarning, /路径格式/);
    assert.equal(flow.tasks[0].parentState, 'unreadable');
    assert.equal(flow.tasks[0].instruction, '');
  } finally { await f.cleanup(); }
});

test('does not label injected child text as an instruction or final reply', () => {
  const evidence = extractTaskEvidence([], [{ message: { role: 'user', content: [
    { type: 'text', text: '<system-reminder>host text</system-reminder>' },
  ] } }], 'call_1');
  assert.equal(evidence.instruction, '');
  assert.equal(evidence.finalText, '');
});

test('uses observed task intervals to distinguish serial and overlapping execution', () => {
  const base = { ownerId: parentId, parentTurnId: 'turn_1', deliveredAt: 201, parentResult: true };
  const first = { ...base, startedAt: 100, endedAt: 120 };
  const second = { ...base, startedAt: 120, endedAt: 170 };
  assert.deepEqual(analyzeExecution([first, second]), {
    sameTurnGroups: [{ count: 2, execution: 'serial', wallMs: 70 }],
    parentResults: 2, delivered: 2,
  });
  assert.equal(analyzeExecution([first, { ...second, startedAt: 110 }]).sameTurnGroups[0].execution, 'overlap');
  assert.equal(analyzeExecution([first, { ...second, endedAt: null }]).sameTurnGroups[0].execution, 'incomplete');
});
