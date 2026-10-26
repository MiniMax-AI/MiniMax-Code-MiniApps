import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { normalizeHookEvent } from '../hooks/normalize.mjs';
import { buildTimeline, executionOverlap, parseEventFiles } from '../miniapp/client/flow.mjs';

const parent = 'mvs_parent';
const child = 'mvs_child';
// Keep fixture ids opaque and deterministic; the recorder itself checks SHA-256 separately below.
const a = 'a'.repeat(64);
const b = 'b'.repeat(64);
const call = 'c'.repeat(64);
const base = { schema: 'agent-flow-hook/v1', parentSession: null, turn: null,
  agent: null, agentType: null, toolUse: null, taskTitle: null, resultPresent: null };
const row = (id, event, at, extra = {}) => ({ ...base, id, event, at, session: a, ...extra });
const jsonl = (rows) => rows.map((item) => JSON.stringify(item)).join('\n') + '\n';

test('Hook keeps bounded metadata and omits the full task prompt and result', () => {
  const normalized = normalizeHookEvent({
    hook_event_name: 'PreToolUse', session_id: parent, turn_id: 'turn_1',
    tool_name: 'task', tool_use_id: 'call_1',
    tool_input: { description: 'Read README', prompt: 'private full instruction' },
  }, 1000, 'row-1');
  assert.equal(normalized.taskTitle, 'Read README');
  assert.equal(normalized.session.length, 64);
  assert.equal(JSON.stringify(normalized).includes('private full instruction'), false);
  assert.equal(normalizeHookEvent({ hook_event_name: 'PreToolUse', session_id: parent, tool_name: 'bash' }), null);
  const finished = normalizeHookEvent({
    hook_event_name: 'PostToolUse', session_id: parent, tool_name: 'task',
    tool_response: { text: 'private child reply', details: { sub_session_id: child } },
  }, 2000, 'row-2');
  assert.equal(finished.resultPresent, true);
  assert.equal(finished.childSession.length, 64);
  assert.equal(finished.childSession, normalizeHookEvent({
    hook_event_name: 'SubagentStart', session_id: child, agent_id: child,
  }, 2001, 'row-3').session);
  assert.equal(JSON.stringify(finished).includes('private child reply'), false);
  assert.equal(JSON.stringify(finished).includes(child), false);
  assert.equal(normalizeHookEvent({
    hook_event_name: 'PostToolUse', session_id: parent, tool_name: 'task',
    tool_response: { agentId: child },
  }).childSession, finished.childSession);
});

test('a Hook invocation writes one plugin-owned record and no stdout', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-flow-events-'));
  try {
    const script = fileURLToPath(new URL('../hooks/record.mjs', import.meta.url));
    const proc = spawn(process.execPath, [script], {
      env: { ...process.env, PLUGIN_DATA: dir }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    proc.stdin.end(JSON.stringify({ hook_event_name: 'SubagentStart', session_id: child,
      agent_id: child, agent_type: 'explore' }));
    let stdout = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    const code = await new Promise((resolve) => proc.on('close', resolve));
    assert.equal(code, 0);
    assert.equal(stdout, '');
    const rows = parseEventFiles([await readFile(join(dir, 'agent-flow-events.jsonl'), 'utf8')]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].event, 'SubagentStart');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('pairs task events by explicit tool ID and leaves child events unlinked without a parent ID', () => {
  const rows = parseEventFiles([jsonl([
    row('1', 'SessionStart', 1000),
    row('2', 'PreToolUse', 1100, { toolUse: call, taskTitle: 'Read README' }),
    row('3', 'SubagentStart', 1200, { session: b, agent: b, agentType: 'explore' }),
    row('4', 'SubagentStop', 1500, { session: b, agent: b }),
    row('5', 'PostToolUse', 1600, { toolUse: call, resultPresent: true }),
    row('5', 'PostToolUse', 1600, { toolUse: call, resultPresent: true }),
  ])]);
  const flow = buildTimeline(rows);
  assert.equal(flow.eventCount, 5);
  assert.equal(flow.tasks.length, 1);
  assert.equal(flow.tasks[0].endAt, 1600);
  assert.equal(flow.tasks[0].resultPresent, true);
  assert.equal(flow.children.length, 1);
  assert.equal(flow.children[0].parentSession, null);
  assert.equal(flow.children[0].endAt, 1500);
});

test('an explicit parent ID links a child; missing task starts and incomplete records stay unpaired', () => {
  const flow = buildTimeline(parseEventFiles([jsonl([
    row('1', 'SubagentStart', 1000, { session: b, agent: b, parentSession: a }),
    row('2', 'PostToolUse', 1100, { toolUse: call }),
    row('3', 'PreToolUse', 1200, { toolUse: 'd'.repeat(64) }),
  ])]));
  assert.equal(flow.children[0].parentSession, a);
  assert.equal(flow.orphanResults.length, 1);
  assert.equal(flow.tasks.length, 1);
  assert.equal(flow.tasks[0].endAt, null);
});

test('task result child session links an exact child lifecycle without reading history', () => {
  const events = [
    normalizeHookEvent({ hook_event_name: 'PreToolUse', session_id: parent,
      tool_name: 'task', tool_use_id: 'task-1', tool_input: { description: 'Read README' } }, 1000, '1'),
    normalizeHookEvent({ hook_event_name: 'SubagentStart', session_id: child,
      agent_id: child, agent_type: 'explore' }, 1100, '2'),
    normalizeHookEvent({ hook_event_name: 'PostToolUse', session_id: parent,
      tool_name: 'task', tool_use_id: 'task-1', tool_response: {
        details: { sub_session_id: child, final_text: 'private result' },
      } }, 1200, '3'),
    normalizeHookEvent({ hook_event_name: 'SubagentStop', session_id: child,
      agent_id: child, agent_type: 'explore' }, 3000, '4'),
  ];
  const flow = buildTimeline(parseEventFiles([jsonl(events)]));
  assert.equal(flow.tasks[0].childSession, flow.children[0].session);
  assert.equal(flow.children[0].parentSession, flow.tasks[0].session);
  assert.equal(flow.children[0].linkedTaskId, flow.tasks[0].id);
  assert.equal(flow.children[0].linkSource, 'task-result');
  assert.equal(JSON.stringify(events).includes('private result'), false);
});

test('conflicting structured child IDs never create a guessed relationship', () => {
  const flow = buildTimeline(parseEventFiles([jsonl([
    row('1', 'PreToolUse', 1000, { toolUse: call }),
    row('2', 'SubagentStart', 1100, { session: b, parentSession: 'd'.repeat(64) }),
    row('3', 'PostToolUse', 1200, { toolUse: call, childSession: b }),
  ])]));
  assert.equal(flow.children[0].relationConflict, true);
  assert.equal(flow.children[0].linkedTaskId, null);
  assert.equal(flow.children[0].linkSource, null);
});

test('rejects unrelated and malformed files instead of inventing a timeline', () => {
  assert.throws(() => parseEventFiles(['{"message":"Host history"}\n']), /不是受支持/);
  assert.throws(() => parseEventFiles(['{"schema":']), /不是完整的 JSON/);
  assert.throws(() => parseEventFiles([jsonl([row('1', 'PreToolUse', 1, { session: '../host' })])]), /不是受支持/);
});

test('overlap uses observed task call intervals', () => {
  const first = { startAt: 100, endAt: 200 };
  assert.equal(executionOverlap([first, { startAt: 200, endAt: 300 }]), false);
  assert.equal(executionOverlap([first, { startAt: 199, endAt: 300 }]), true);
  assert.equal(executionOverlap([first, { startAt: 150, endAt: null }]), false);
});

test('quick task returns do not erase overlapping child execution', () => {
  const flow = buildTimeline(parseEventFiles([jsonl([
    row('1', 'PreToolUse', 1000, { toolUse: call }),
    row('2', 'SubagentStart', 1050, { session: b, agent: b }),
    row('3', 'PostToolUse', 1100, { toolUse: call, resultPresent: true }),
    row('4', 'PreToolUse', 1200, { toolUse: 'd'.repeat(64) }),
    row('5', 'SubagentStart', 1250, { session: 'e'.repeat(64), agent: 'e'.repeat(64) }),
    row('6', 'PostToolUse', 1300, { toolUse: 'd'.repeat(64), resultPresent: true }),
    row('7', 'SubagentStop', 5000, { session: b, agent: b }),
    row('8', 'SubagentStop', 6000, { session: 'e'.repeat(64), agent: 'e'.repeat(64) }),
  ])]));
  assert.equal(executionOverlap(flow.tasks), false);
  assert.equal(executionOverlap(flow.children), true);
  assert.equal(flow.children.every((item) => item.parentSession === null), true);
});
