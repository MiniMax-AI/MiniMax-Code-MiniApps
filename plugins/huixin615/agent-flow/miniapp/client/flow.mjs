const EVENTS = new Set(['SessionStart', 'PreToolUse', 'PostToolUse', 'SubagentStart', 'SubagentStop']);
const HEX = /^[a-f0-9]{64}$/;
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_ROWS = 30_000;

function hash(value) { return value === null || (typeof value === 'string' && HEX.test(value)); }

export function parseEventFiles(texts) {
  if (!Array.isArray(texts) || texts.length === 0) throw new Error('请选择插件生成的 JSONL 记录文件。');
  const rows = [];
  const seen = new Set();
  let bytes = 0;
  for (const text of texts) {
    if (typeof text !== 'string') throw new Error('记录文件不是文本。');
    bytes += new TextEncoder().encode(text).length;
    if (bytes > MAX_BYTES) throw new Error('记录文件合计超过 12 MiB，请只选择需要查看的文件。');
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (!line) continue;
      if (line.length > 4096) throw new Error(`第 ${index + 1} 行过长，已停止导入。`);
      let row;
      try { row = JSON.parse(line); }
      catch { throw new Error(`第 ${index + 1} 行不是完整的 JSON。请稍后重新选择文件。`); }
      if (row?.schema !== 'agent-flow-hook/v1' || typeof row.id !== 'string'
        || row.id.length > 80 || !EVENTS.has(row.event) || !Number.isSafeInteger(row.at)
        || row.at <= 0 || !HEX.test(row.session) || !hash(row.parentSession)
        || !hash(row.turn) || !hash(row.agent) || !hash(row.toolUse)
        || (row.childSession !== undefined && !hash(row.childSession))
        || (row.taskTitle != null && (typeof row.taskTitle !== 'string' || row.taskTitle.length > 160))
        || (row.agentType != null && (typeof row.agentType !== 'string' || row.agentType.length > 160))) {
        throw new Error(`第 ${index + 1} 行不是受支持的 Agent Flow 事件。`);
      }
      if (!seen.has(row.id)) {
        seen.add(row.id);
        rows.push({
          id: row.id, at: row.at, event: row.event, session: row.session,
          parentSession: row.parentSession, turn: row.turn, agent: row.agent,
          agentType: row.agentType, toolUse: row.toolUse, childSession: row.childSession ?? null,
          taskTitle: row.taskTitle,
          resultPresent: row.resultPresent === true,
        });
        if (rows.length > MAX_ROWS) throw new Error('事件数超过 30000，请分批导入。');
      }
    }
  }
  rows.sort((a, b) => a.at - b.at);
  return rows;
}

export function buildTimeline(rows) {
  const sessions = new Map();
  const tasks = new Map();
  const children = new Map();
  const orphanResults = [];
  for (const row of rows) {
    const session = sessions.get(row.session) ?? { id: row.session, firstAt: row.at, lastAt: row.at, taskCount: 0 };
    session.firstAt = Math.min(session.firstAt, row.at);
    session.lastAt = Math.max(session.lastAt, row.at);
    sessions.set(row.session, session);
    if (row.event === 'PreToolUse') {
      const key = row.toolUse ? `${row.session}:${row.toolUse}` : row.id;
      if (!tasks.has(key)) {
        tasks.set(key, { id: key, session: row.session, turn: row.turn, title: row.taskTitle,
          startAt: row.at, endAt: null, resultPresent: false, childSession: null,
          childSessionConflict: false });
        session.taskCount += 1;
      }
    } else if (row.event === 'PostToolUse') {
      const task = row.toolUse ? tasks.get(`${row.session}:${row.toolUse}`) : null;
      if (task) {
        task.endAt = Math.max(task.startAt, row.at);
        task.resultPresent ||= row.resultPresent;
        if (row.childSession) {
          if (task.childSession && task.childSession !== row.childSession) task.childSessionConflict = true;
          else task.childSession = row.childSession;
        }
      } else orphanResults.push(row);
    } else if (row.event === 'SubagentStart' || row.event === 'SubagentStop') {
      const key = row.session;
      const child = children.get(key) ?? { id: key, session: row.session,
        parentSession: row.parentSession, agentType: row.agentType,
        startAt: null, endAt: null, linkedTaskId: null, linkSource: null,
        relationConflict: false };
      if (row.parentSession) {
        if (child.parentSession && child.parentSession !== row.parentSession) child.relationConflict = true;
        else child.parentSession = row.parentSession;
      }
      if (row.agentType) child.agentType = row.agentType;
      if (row.event === 'SubagentStart') child.startAt = Math.min(child.startAt ?? row.at, row.at);
      else child.endAt = Math.max(child.endAt ?? row.at, row.at);
      children.set(key, child);
    }
  }
  const tasksByChild = new Map();
  for (const task of tasks.values()) {
    if (task.childSession && !task.childSessionConflict) {
      const matches = tasksByChild.get(task.childSession) ?? [];
      matches.push(task);
      tasksByChild.set(task.childSession, matches);
    }
  }
  for (const child of children.values()) {
    const matches = tasksByChild.get(child.session) ?? [];
    if (matches.length === 1) {
      const [task] = matches;
      if (child.parentSession && child.parentSession !== task.session) child.relationConflict = true;
      if (!child.relationConflict) {
        child.parentSession = task.session;
        child.linkedTaskId = task.id;
        child.linkSource = 'task-result';
      }
    } else if (matches.length > 1) child.relationConflict = true;
    if (!child.linkSource && child.parentSession && !child.relationConflict) child.linkSource = 'hook-parent';
  }
  return {
    sessions: [...sessions.values()].sort((a, b) => b.lastAt - a.lastAt),
    tasks: [...tasks.values()].sort((a, b) => a.startAt - b.startAt),
    children: [...children.values()].sort((a, b) => (a.startAt ?? a.endAt) - (b.startAt ?? b.endAt)),
    orphanResults,
    eventCount: rows.length,
  };
}

export function executionOverlap(tasks) {
  const complete = tasks.filter((task) => task.endAt !== null);
  for (let i = 0; i < complete.length; i += 1) {
    for (let j = i + 1; j < complete.length; j += 1) {
      if (complete[i].startAt < complete[j].endAt && complete[j].startAt < complete[i].endAt) return true;
    }
  }
  return false;
}
