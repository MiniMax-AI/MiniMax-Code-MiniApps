/**
 * The team tools the bridge needs, with the schemas the real server advertises.
 *
 * The schemas are the ones the official `minimax-bot` MCP server publishes, because the
 * bridge maps a message onto the tool's own argument names: without the schema it
 * cannot know that a Bot is called `to` and a group is called `group`.
 */
export const TEAM_TOOL_DESCRIPTORS = [
  { name: 'mcp__minimax-bot__list_team', server: 'minimax-bot', tool: 'list_team' },
  {
    name: 'mcp__minimax-bot__message_bot',
    server: 'minimax-bot',
    tool: 'message_bot',
    inputSchema: {
      type: 'object',
      properties: {
        caller_bot_id: { type: 'string', minLength: 1 },
        request_id: { type: 'string', pattern: '^[A-Za-z0-9_.-]{1,128}$' },
        to: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['to', 'message'],
      additionalProperties: false,
    },
  },
  {
    name: 'mcp__minimax-bot__post_group',
    server: 'minimax-bot',
    tool: 'post_group',
    inputSchema: {
      type: 'object',
      properties: {
        caller_bot_id: { type: 'string', minLength: 1 },
        request_id: { type: 'string', pattern: '^[A-Za-z0-9_.-]{1,128}$' },
        group: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['group', 'message'],
      additionalProperties: false,
    },
  },
  {
    name: 'mcp__minimax-bot__get_tasks',
    server: 'minimax-bot',
    tool: 'get_tasks',
    inputSchema: {
      type: 'object',
      properties: {
        caller_bot_id: { type: 'string', minLength: 1 },
        task_id: { type: 'string' },
        batch_id: { type: 'string' },
        wait_ms: { type: 'integer', minimum: 0, maximum: 20000 },
        result_offset: { type: 'integer', minimum: 0 },
      },
      required: [],
      additionalProperties: false,
      oneOf: [{ required: ['task_id'] }, { required: ['batch_id'] }],
    },
  },
  {
    name: 'mcp__minimax-bot__cancel_tasks',
    server: 'minimax-bot',
    tool: 'cancel_tasks',
    inputSchema: {
      type: 'object',
      properties: {
        caller_bot_id: { type: 'string', minLength: 1 },
        task_id: { type: 'string' },
        batch_id: { type: 'string' },
      },
      required: [],
      additionalProperties: false,
      oneOf: [{ required: ['task_id'] }, { required: ['batch_id'] }],
    },
  },
];

/**
 * A fake `@minimax-bot` team.
 *
 * The answers are the shapes the real team answers in — the durable admission receipt,
 * the task view, the settled result — copied from the official plugin's own task
 * dispatcher, so a test that passes here is a test of the same contract the desktop
 * answers.
 *
 * The team owns what a Bot is: its instructions, its model, its effort and its session.
 * This fake does not pretend to be a model; it reports the reply it was configured
 * with, under the Bot that was addressed, in that Bot's session.
 */

/**
 * The roster the fake team answers `list_team` with.
 *
 * The shape is the one the real tool answers in: `bot_id`, `main`, members and admin
 * by name, `reply_mode`.
 */
export const TEAM_BOTS = [
  {
    bot_id: 'bot_b1',
    name: 'Writer',
    role: 'Long-form drafting',
    main: false,
    model: 'minimax/MiniMax-M3.1-Flash',
    effort: 'default',
  },
  {
    bot_id: 'bot_b2',
    name: 'Reviewer',
    role: 'Second pair of eyes',
    main: false,
    model: 'minimax/MiniMax-M3.1-Flash',
    effort: 'high',
  },
];

export const TEAM_GROUPS = [
  {
    group_id: 'grp_g1',
    name: 'Team',
    notice: 'The whole team.',
    admin: 'Writer',
    members: ['Writer', 'Reviewer'],
    reply_mode: 'admin',
  },
];

/**
 * Wraps a value the way the team's MCP server wraps it: as JSON text in one content
 * block, under a `value` key.
 *
 * @param {unknown} value
 */
function mcp(value) {
  return {
    kind: 'mcp',
    isError: false,
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  };
}

/**
 * Builds a fake team.
 *
 * @param {object} [options]
 * @param {Array<any>} [options.bots] the roster
 * @param {Array<any>} [options.groups] the groups
 * @param {Record<string, string>} [options.replies] the reply each Bot makes
 * @param {Record<string, string>} [options.sessions] the session each Bot answers in
 * @param {(task: any) => void} [options.onTask] called when a task settles
 * @param {boolean} [options.resolveUnknown] answer for a Bot that is not in the roster
 * @param {boolean} [options.hold] keep the task running instead of settling it
 */
export function createFakeTeam({
  bots = TEAM_BOTS,
  groups = TEAM_GROUPS,
  replies = {},
  sessions = {},
  onTask,
  resolveUnknown = false,
  hold = false,
} = {}) {
  /** @type {Array<{name: string, arguments: any}>} */
  const calls = [];
  /** @type {Map<string, any>} */
  const tasks = new Map();
  let counter = 0;

  const findBot = (ref) =>
    bots.find(
      (bot) =>
        bot.bot_id === ref ||
        String(bot.name).toLowerCase() === String(ref ?? '').toLowerCase(),
    ) ??
    // A test that only cares about how many conversations the bridge remembers does
    // not need a roster entry for every one of them.
    (resolveUnknown && ref
      ? { bot_id: String(ref), name: String(ref), role: '', main: false, model: '', effort: 'default' }
      : undefined);

  const findGroup = (ref) =>
    groups.find(
      (group) =>
        group.group_id === ref ||
        String(group.name).toLowerCase() === String(ref ?? '').toLowerCase(),
    );

  /**
   * The task view, in the shape the team reports it.
   *
   * @param {any} task
   */
  const view = (task) => ({
    task_id: task.task_id,
    kind: task.kind,
    ...(task.bot_id ? { bot_id: task.bot_id } : {}),
    title: task.title,
    status: task.status,
    chat_id: task.chat_id,
    session_id: task.session_id,
    result_message_id: task.result_message_id,
    created_at: task.created_at,
    started_at: task.started_at,
    ended_at: task.ended_at,
    ...(task.error ? { error: task.error } : {}),
    // The result is the Bot's finished answer, so a task that has not finished has
    // none.
    ...(task.status === 'done' && task.result ? { result: task.result } : {}),
  });

  /**
   * @param {string} name the qualified tool name
   * @param {any} args
   */
  async function call(name, args = {}) {
    calls.push({ name, arguments: args });
    const tool = String(name).split('__').pop();

    if (tool === 'list_team') return mcp({ bots, groups });

    if (tool === 'message_bot') {
      const bot = findBot(args.to);
      if (!bot) {
        return { kind: 'mcp', isError: true, content: [{ type: 'text', text: 'unknown bot' }] };
      }
      counter += 1;
      const taskId = `task_${counter}`;
      const batchId = `batch_${counter}`;
      const text = String(args.message ?? '');
      tasks.set(taskId, {
        task_id: taskId,
        batch_id: batchId,
        request_id: args.request_id,
        kind: 'bot',
        bot_id: bot.bot_id,
        title: text.replace(/\s+/g, ' ').slice(0, 80),
        status: hold ? 'running' : 'done',
        chat_id: `bot:${bot.bot_id}`,
        session_id: sessions[bot.bot_id] ?? `sess_${bot.bot_id}`,
        // The desktop names the message that carried the turn in `msg_task_<id>`, and
        // the Bot's own answer gets a record of its own, which is what the receipt
        // points at.
        result_message_id: `msg_reply_${taskId}`,
        result: replies[bot.bot_id] ?? `${bot.name} answers.`,
        created_at: 1,
        started_at: 2,
        ended_at: 3,
      });
      onTask?.(tasks.get(taskId));
      // The receipt is captured before the work starts, so it still says "queued".
      return mcp({
        value: {
          batch_id: batchId,
          request_id: args.request_id,
          notification: 'pending',
          complete: false,
          tasks: [
            {
              task_id: taskId,
              kind: 'bot',
              bot_id: bot.bot_id,
              title: text.replace(/\s+/g, ' ').slice(0, 80),
              status: 'queued',
              chat_id: `bot:${bot.bot_id}`,
              created_at: 1,
            },
          ],
        },
        event: { kind: 'asked', botId: bot.bot_id, text },
      });
    }

    if (tool === 'post_group') {
      const group = findGroup(args.group);
      if (!group) {
        return { kind: 'mcp', isError: true, content: [{ type: 'text', text: 'unknown group' }] };
      }
      counter += 1;
      const taskId = `task_${counter}`;
      const batchId = `batch_${counter}`;
      const text = String(args.message ?? '');
      tasks.set(taskId, {
        task_id: taskId,
        batch_id: batchId,
        request_id: args.request_id,
        kind: 'discussion',
        title: text.replace(/\s+/g, ' ').slice(0, 80),
        status: 'done',
        chat_id: `group:${group.group_id}`,
        session_id: sessions[group.group_id] ?? `sess_${group.group_id}`,
        result_message_id: `msg_reply_${taskId}`,
        result: replies[group.group_id] ?? `${group.name} answers.`,
        created_at: 1,
        started_at: 2,
        ended_at: 3,
      });
      onTask?.(tasks.get(taskId));
      return mcp({
        value: {
          batch_id: batchId,
          request_id: args.request_id,
          notification: 'pending',
          complete: false,
          posted_to: group.name,
          group_id: group.group_id,
          first_speaker: [group.admin],
          tasks: [
            {
              task_id: taskId,
              kind: 'discussion',
              title: text.replace(/\s+/g, ' ').slice(0, 80),
              status: 'queued',
              chat_id: `group:${group.group_id}`,
              created_at: 1,
            },
          ],
        },
        event: { kind: 'group_posted', groupId: group.group_id },
      });
    }

    if (tool === 'get_tasks') {
      const task = args.task_id
        ? tasks.get(args.task_id)
        : [...tasks.values()].find((entry) => entry.batch_id === args.batch_id);
      if (!task) {
        // The team is asked about batches it knows; a batch it has no task for answers
        // with an empty list rather than with an error.
        return mcp({
          value: {
            batch_id: args.batch_id ?? '',
            request_id: 'req',
            notification: 'idle',
            complete: true,
            tasks: [],
          },
        });
      }
      // The real team holds the query until the task settles or the wait runs out, so
      // a task that is still running does not spin the caller.
      if (task.status !== 'done' && task.status !== 'failed' && task.status !== 'cancelled') {
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      return mcp({
        value: {
          batch_id: task.batch_id,
          request_id: task.request_id,
          notification: 'done',
          complete: true,
          tasks: [view(task)],
        },
      });
    }

    if (tool === 'cancel_tasks') {
      const task = args.task_id
        ? tasks.get(args.task_id)
        : [...tasks.values()].find((entry) => entry.batch_id === args.batch_id);
      if (!task) {
        return { kind: 'mcp', isError: true, content: [{ type: 'text', text: 'no such task' }] };
      }
      task.status = 'cancelled';
      task.ended_at = 4;
      return mcp({
        value: {
          batch_id: task.batch_id,
          request_id: task.request_id,
          notification: 'done',
          complete: true,
          tasks: [view(task)],
        },
      });
    }

    return mcp({ ok: true });
  }

  /**
   * Puts a task into the team, the way a turn that already ran would have left it.
   *
   * @param {any} task
   */
  function seedTask(task) {
    const seeded = {
      batch_id: 'batch_1',
      request_id: 'req_1',
      kind: 'bot',
      bot_id: 'bot_b1',
      title: 'a task',
      status: 'running',
      chat_id: 'bot:bot_b1',
      session_id: 'sess-1',
      created_at: 1,
      started_at: 1,
      ...task,
    };
    tasks.set(seeded.task_id, seeded);
    return seeded;
  }

  return { call, calls, tasks, seedTask };
}
