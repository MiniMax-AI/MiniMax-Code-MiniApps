import { createHash, randomUUID } from 'node:crypto';

const EVENT_NAMES = new Set(['SessionStart', 'PreToolUse', 'PostToolUse', 'SubagentStart', 'SubagentStop']);
const digest = (value) => typeof value === 'string' && value
  ? createHash('sha256').update(value).digest('hex') : null;

function childSessionFromResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const details = value.details && typeof value.details === 'object' && !Array.isArray(value.details)
    ? value.details : {};
  // Native task results expose sub_session_id in details. The compatible Hook
  // response exposes the same child session as agentId. Never inspect text.
  const candidates = [details.sub_session_id, value.sub_session_id, value.agentId]
    .filter((item) => typeof item === 'string' && item.length > 0);
  return candidates.length && candidates.every((item) => item === candidates[0])
    ? digest(candidates[0]) : null;
}

function shortText(value) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 160) : null;
}

export function normalizeHookEvent(input, at = Date.now(), id = randomUUID()) {
  if (!input || typeof input !== 'object' || !EVENT_NAMES.has(input.hook_event_name)) return null;
  const event = input.hook_event_name;
  if ((event === 'PreToolUse' || event === 'PostToolUse') && input.tool_name !== 'task') return null;
  const session = digest(input.session_id);
  if (!session || !Number.isFinite(at)) return null;
  const taskInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  return {
    schema: 'agent-flow-hook/v1', id, at, event, session,
    parentSession: digest(input.parent_session_id),
    turn: digest(input.turn_id),
    agent: digest(input.agent_id),
    agentType: shortText(input.agent_type),
    toolUse: digest(input.tool_use_id),
    childSession: event === 'PostToolUse' ? childSessionFromResult(input.tool_response) : null,
    taskTitle: event === 'PreToolUse'
      ? shortText(taskInput.description ?? taskInput.title ?? taskInput.name) : null,
    resultPresent: event === 'PostToolUse' ? input.tool_response != null : null,
  };
}
