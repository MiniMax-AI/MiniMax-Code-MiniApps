// @ts-check
import { EngineError } from './engine.mjs';
import { hostMemoryEnabled, searchHostMemory } from './host-memory.mjs';
import { t } from './i18n.mjs';
import { MemoryError } from './memory.mjs';
import { BOT_COLORS, BOT_SKINS, effortOptions, withEffort, newId } from './store.mjs';
import { MEMORY_SCOPES } from './team.mjs';
import { AGENT_FILE_MAX, AGENT_FILE_RE } from './agent-file.mjs';
import { PLUGIN_ID, PLUGIN_VERSION } from './plugin-id.mjs';

/** @typedef {import('./team.mjs').Team} Team */
/** @typedef {import('./engine.mjs').Engine} Engine */

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

/** What a Bot sees of a schedule. */
function scheduleView(schedule) {
  return {
    schedule_id: schedule.id,
    name: schedule.name,
    bot_id: schedule.botId,
    kind: schedule.kind,
    ...(schedule.kind === 'daily' ? { time: schedule.time } : {}),
    ...(schedule.kind === 'interval' ? { every_minutes: schedule.everyMinutes } : {}),
    prompt: schedule.prompt,
    enabled: schedule.enabled,
    next_run: schedule.nextRunAt ? new Date(schedule.nextRunAt).toISOString() : null,
    last_run: schedule.lastRunAt ? new Date(schedule.lastRunAt).toISOString() : null,
  };
}

/** Tool definitions in the current language (they are model-facing, so they follow the user). */
function toolDefs() {
  const caller = {
    caller_bot_id: {
      type: 'string',
      minLength: 1,
      description: t('mcp.p.caller'),
    },
    external_agent: {
      type: 'string',
      minLength: 1,
      maxLength: 64,
      pattern: '^[A-Za-z0-9_-]{1,64}$',
      description: t('mcp.p.externalAgent'),
    },
  };

  function schema(properties, required = []) {
    return { type: 'object', properties: { ...caller, ...properties }, required, additionalProperties: false };
  }

  return [
    {
      name: 'list_team',
      description: t('mcp.t.list_team'),
      inputSchema: schema({}),
    },
    {
      name: 'list_agent_files',
      description: t('mcp.t.list_agent_files'),
      inputSchema: schema({
        bot: { type: 'string', description: t('mcp.p.agentFileBot') },
      }),
    },
    {
      name: 'read_agent_file',
      description: t('mcp.t.read_agent_file'),
      inputSchema: schema({
        bot: { type: 'string', description: t('mcp.p.agentFileBot') },
        name: { type: 'string', pattern: AGENT_FILE_RE.source, description: t('mcp.p.agentFileName') },
      }, ['name']),
    },
    {
      name: 'write_agent_file',
      description: t('mcp.t.write_agent_file'),
      inputSchema: schema({
        bot: { type: 'string', description: t('mcp.p.agentFileBot') },
        name: { type: 'string', pattern: AGENT_FILE_RE.source, description: t('mcp.p.agentFileName') },
        text: { type: 'string', minLength: 1, maxLength: AGENT_FILE_MAX, description: t('mcp.p.agentFileText') },
      }, ['name', 'text']),
    },
    {
      name: 'message_bot',
      description:
        t('mcp.t.message_bot'),
      inputSchema: schema(
        {
          request_id: { type: 'string', pattern: '^[A-Za-z0-9_.-]{1,128}$', description: t('mcp.p.requestId') },
          to: { type: 'string', description: t('mcp.p.to') },
          message: { type: 'string', description: t('mcp.p.message') },
        },
        ['to', 'message'],
      ),
    },
    {
      name: 'dispatch_tasks', description: t('mcp.t.dispatch_tasks'),
      inputSchema: schema({
        request_id: { type: 'string', pattern: '^[A-Za-z0-9_.-]{1,128}$', description: t('mcp.p.requestId') },
        tasks: { type: 'array', minItems: 1, maxItems: 32, items: {
          type: 'object', additionalProperties: false, required: ['to', 'message'],
          properties: { to: { type: 'string' }, message: { type: 'string', minLength: 1, maxLength: 20000 }, title: { type: 'string', maxLength: 80 } },
        } },
      }, ['request_id', 'tasks']),
    },
    {
      name: 'acknowledge_task',
      description: t('mcp.t.acknowledge_task'),
      inputSchema: schema({
        task_id: { type: 'string', description: t('mcp.p.acknowledgeTaskId') },
        receipt: { type: 'string', minLength: 1, maxLength: 4000, description: t('mcp.p.acknowledgeReceipt') },
      }, ['task_id', 'receipt']),
    },
    ...['get_tasks', 'cancel_tasks'].map((name) => ({
      name, description: t(`mcp.t.${name}`),
      inputSchema: { ...schema({
        task_id: { type: 'string' }, batch_id: { type: 'string' },
        ...(name === 'get_tasks' ? { wait_ms: { type: 'integer', minimum: 0, maximum: 20000 }, result_offset: { type: 'integer', minimum: 0 } } : {}),
      }), oneOf: [{ required: ['task_id'] }, { required: ['batch_id'] }] },
    })),
    {
      name: 'post_group',
      description:
        t('mcp.t.post_group'),
      inputSchema: schema(
        {
          request_id: { type: 'string', pattern: '^[A-Za-z0-9_.-]{1,128}$', description: t('mcp.p.requestId') },
          group: { type: 'string', description: t('mcp.p.group') },
          message: { type: 'string', description: t('mcp.p.postMessage') },
        },
        ['group', 'message'],
      ),
    },
    {
      name: 'start_helper',
      description: t('mcp.t.start_helper'),
      inputSchema: schema(
        {
          task: { type: 'string', description: t('mcp.p.helperTask') },
          title: { type: 'string', description: t('mcp.p.helperTitle') },
        },
        ['caller_bot_id', 'task'],
      ),
    },
    {
      name: 'list_helpers',
      description: t('mcp.t.list_helpers'),
      inputSchema: schema({}),
    },
    {
      name: 'stop_helper',
      description: t('mcp.t.stop_helper'),
      inputSchema: schema({ helper_id: { type: 'string', description: t('mcp.p.helperId') } }, ['helper_id']),
    },
    {
      name: 'create_bot',
      description: t('mcp.t.create_bot'),
      inputSchema: schema(
        {
          name: { type: 'string', description: t('mcp.p.name') },
          role: { type: 'string', description: t('mcp.p.role') },
          instructions: { type: 'string', description: t('mcp.p.instructions') },
          skin: { type: 'string', enum: BOT_SKINS, description: t('mcp.p.skin') },
          color: { type: 'string', enum: BOT_COLORS, description: t('mcp.p.color') },
          model: { type: 'string', description: t('mcp.p.model') },
          effort: { type: 'string', description: t('mcp.p.effort') },
          avatar: { type: 'string', description: t('mcp.p.avatar') },
          auto_helper: { type: 'boolean', description: t('mcp.p.autoHelper') },
          main: { type: 'boolean', description: t('mcp.p.main') },
        },
        ['name', 'role', 'instructions'],
      ),
    },
    {
      name: 'update_bot',
      description: t('mcp.t.update_bot'),
      inputSchema: schema(
        {
          bot: { type: 'string', description: t('mcp.p.botToUpdate') },
          name: { type: 'string' },
          role: { type: 'string' },
          instructions: { type: 'string' },
          skin: { type: 'string', enum: BOT_SKINS, description: t('mcp.p.skin') },
          color: { type: 'string', enum: BOT_COLORS, description: t('mcp.p.color') },
          model: { type: 'string', description: t('mcp.p.model') },
          effort: { type: 'string', description: t('mcp.p.effort') },
          avatar: { type: 'string', description: t('mcp.p.avatar') },
          auto_helper: { type: 'boolean', description: t('mcp.p.autoHelper') },
          main: { type: 'boolean' },
        },
        ['bot'],
      ),
    },
    {
      name: 'delete_bot',
      description: t('mcp.t.delete_bot'),
      inputSchema: schema({ bot: { type: 'string', description: t('mcp.p.bot') } }, ['bot']),
    },
    {
      name: 'create_group',
      description: t('mcp.t.create_group'),
      inputSchema: schema(
        {
          name: { type: 'string', description: t('mcp.p.groupName') },
          members: { type: 'array', items: { type: 'string' }, description: t('mcp.p.members') },
          admin: { type: 'string', description: t('mcp.p.admin') },
          notice: { type: 'string', description: t('mcp.p.notice') },
          reply_mode: {
            type: 'string',
            enum: ['admin', 'all'],
            description: t('mcp.p.replyMode'),
          },
        },
        ['name', 'members'],
      ),
    },
    {
      name: 'update_group',
      description: t('mcp.t.update_group'),
      inputSchema: schema(
        {
          group: { type: 'string', description: t('mcp.p.group') },
          name: { type: 'string' },
          notice: { type: 'string' },
          members: { type: 'array', items: { type: 'string' } },
          admin: { type: 'string' },
          reply_mode: { type: 'string', enum: ['admin', 'all'] },
        },
        ['group'],
      ),
    },
    {
      name: 'delete_group',
      description: t('mcp.t.delete_group'),
      inputSchema: schema({ group: { type: 'string', description: t('mcp.p.group') } }, ['group']),
    },
    {
      name: 'create_schedule',
      description: t('mcp.t.create_schedule'),
      inputSchema: schema(
        {
          prompt: { type: 'string', description: t('mcp.p.schedulePrompt') },
          name: { type: 'string', description: t('mcp.p.scheduleName') },
          kind: { type: 'string', enum: ['daily', 'interval', 'once'], description: t('mcp.p.scheduleKind') },
          time: { type: 'string', description: t('mcp.p.scheduleTime') },
          every_minutes: { type: 'integer', minimum: 5, description: t('mcp.p.everyMinutes') },
          in_minutes: { type: 'integer', minimum: 1, description: t('mcp.p.inMinutes') },
          target_bot: { type: 'string', description: t('mcp.p.scheduleTarget') },
        },
        ['prompt', 'kind'],
      ),
    },
    {
      name: 'list_schedules',
      description: t('mcp.t.list_schedules'),
      inputSchema: schema({}),
    },
    {
      name: 'delete_schedule',
      description: t('mcp.t.delete_schedule'),
      inputSchema: schema({ schedule_id: { type: 'string', description: t('mcp.p.scheduleId') } }, ['schedule_id']),
    },
    {
      name: 'host_memory_search',
      description: t('mcp.t.host_memory_search'),
      inputSchema: schema({
        query: { type: 'string', minLength: 1, maxLength: 200, description: t('mcp.p.memoryQuery') },
        limit: { type: 'integer', minimum: 1, maximum: 8, description: t('mcp.p.memoryLimit') },
      }, ['query']),
    },
    {
      name: 'memory_pending',
      description: t('mcp.t.memory_pending'),
      inputSchema: schema({
        limit: { type: 'integer', minimum: 1, maximum: 20, description: t('mcp.p.memoryLimit') },
      }),
    },
  ];

}

/** Tool names, for lookups that must not depend on the language. */
export const TOOL_NAMES = toolDefs().map((tool) => tool.name);

/** Whether a value is of the JSON type a schema declares. */
function isJsonType(type, value) {
  if (type === 'string') return typeof value === 'string';
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  return true;
}

/**
 * The enums a tool answers itself.
 *
 * For these the tool's answer says more than the schema can: the range, and what the value
 * would have changed had it been accepted. So the value reaches the tool and the model reads
 * the tool's message, not a generic one. Every other declared enum is checked here, before the
 * tool runs, so a value that would otherwise be read as a different legal one never changes
 * anything.
 */
const TOOL_OWNED_ENUMS = new Set([
  'create_group.reply_mode', 'update_group.reply_mode',
  'create_schedule.kind',
]);

/**
 * What is wrong with the arguments of a tool call, judged by the inputSchema the tool itself
 * declares: a value of the wrong JSON type, or a value outside a declared enum. The other rules
 * of a tool (a topic a memory needs, a text that may not be longer than X) belong to the tool,
 * which answers them with its own message; here only the shape of a value is checked, so a
 * call that does not fit the schema never reaches the tool and never changes anything.
 * @param {string} tool the tool being called, for the enums the tool answers itself
 * @param {any} schema
 * @param {any} args
 * @returns {string[]} the problems, empty when the arguments fit the schema
 */
function schemaProblems(tool, schema, args) {
  if (!schema || schema.type !== 'object') return [];
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return [t('mcp.err.argObject')];
  }
  const problems = [];
  for (const [name, value] of Object.entries(args)) {
    // An argument the tool did not declare is left to the tool: dispatch_tasks, for one, has a
    // message of its own for the options it does not support.
    const property = schema.properties?.[name];
    if (!property || value === null || value === undefined) continue;
    if (property.type && !isJsonType(property.type, value)) {
      problems.push(t('mcp.err.argType', { name, type: property.type }));
      continue;
    }
    if (Array.isArray(property.enum) && !property.enum.includes(value)
      && !TOOL_OWNED_ENUMS.has(`${tool}.${name}`)) {
      problems.push(t('mcp.err.argEnum', { name, values: property.enum.join(', '), value: String(value) }));
    }
  }
  return problems;
}

/**
 * @param {{ team: Team, engine: Engine }} deps
 */
/**
 * A catalog entry as the composer would select it: thinking on when the model offers it (an
 * omitted variant clears the session's, it is not inherited), at the model's default effort.
 */
const toSelection = (m) => ({
  providerId: m.providerId,
  modelId: m.modelId,
  ...(m.variants?.includes('thinking') ? { variant: 'thinking' } : {}),
  ...(m.thinking?.default ? { thinking: { effort: m.thinking.default } } : {}),
});

export function createMcpHandler({ team, engine }) {
  /**
   * Whether the memory of the Host may be read. It is off until the user turns it on in the
   * settings, so the tool is not even offered by default.
   */
  const hostMemoryOn = () => hostMemoryEnabled(team.store.state.settings);
  const store = team.store;

  function resolveCaller(args) {
    const id = args?.caller_bot_id;
    if (id) {
      const bot = store.getBot(id);
      if (!bot) throw new EngineError('invalid', t('mcp.err.badCaller', { id }));
      return bot;
    }
    // An external agent — the Chief Bot of a Feishu or WeChat bridge, for example — drives the
    // team from outside the plugin. It acts with the authority of the user, but it is named, so
    // the batch it starts is its own and can be told apart from the one the page started.
    const agent = args?.external_agent;
    if (agent === undefined || agent === null || agent === '') return undefined;
    const name = String(agent).trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) {
      throw new EngineError('invalid', t('mcp.err.badExternalAgent', { id: name }));
    }
    return { id: 'external:' + name, name, isMain: true, external: true, agent: name };
  }

  /**
   * The text a failed tool call shows the model. A failure the plugin knows (EngineError,
   * MemoryError) carries its own message, written for the model. Anything else is a fault of
   * the plugin: the model gets a generic line it cannot act on anyway, and the detail goes
   * to the log, where the operator reads it.
   */
  function failureText(error, name) {
    if (error instanceof EngineError || error instanceof MemoryError) return String(error.message);
    engine.logger?.warn?.('minimax_bot.tool_failed', {
      tool: name, code: error?.code ?? 'unknown', detail: String(error?.message ?? error),
    });
    return t('mcp.err.internal');
  }

  const LIVE = {
    // Sent as keys so the page renders them in its own language.
    message_bot: (a) => ({ key: 'live.askBot', params: { name: store.getBot(a.to)?.name ?? a.to ?? t('mcp.anotherBot') } }),
    start_helper: (a) => ({ key: 'live.startHelper', params: { name: String(a.title ?? a.task ?? '').slice(0, 40) } }),
    list_helpers: () => ({ key: 'live.listHelpers' }),
    stop_helper: () => ({ key: 'live.stopHelper' }),
    post_group: (a) => ({ key: 'live.postGroup', params: { name: store.getGroup(a.group)?.name ?? a.group ?? '' } }),
    create_bot: (a) => ({ key: 'live.createBot', params: { name: a.name ?? 'Bot' } }),
    update_bot: (a) => ({ key: 'live.updateBot', params: { name: store.getBot(a.bot)?.name ?? a.bot ?? 'Bot' } }),
    delete_bot: (a) => ({ key: 'live.deleteBot', params: { name: store.getBot(a.bot)?.name ?? a.bot ?? 'Bot' } }),
    create_group: (a) => ({ key: 'live.createGroup', params: { name: a.name ?? '' } }),
    update_group: (a) => ({ key: 'live.updateGroup', params: { name: store.getGroup(a.group)?.name ?? a.group ?? '' } }),
    delete_group: (a) => ({ key: 'live.deleteGroup', params: { name: store.getGroup(a.group)?.name ?? a.group ?? '' } }),
    list_team: () => ({ key: 'live.listTeam' }),
    list_agent_files: () => ({ key: 'live.listAgentFiles' }),
    read_agent_file: () => ({ key: 'live.readAgentFile' }),
    write_agent_file: () => ({ key: 'live.writeAgentFile' }),
    create_schedule: (a) => ({ key: 'live.createSchedule', params: { name: a.name ?? '' } }),
    list_schedules: () => ({ key: 'live.listSchedules' }),
    delete_schedule: () => ({ key: 'live.deleteSchedule' }),
    acknowledge_task: () => ({ key: 'live.acknowledgeTask' }),
  };

  /** @returns {Promise<unknown>} */
  async function callTool(name, args, signal) {
    const who = resolveCaller(args);
    // Capture at admission, before any await. Never re-attribute a slow tool to a newer turn.
    // The turn is found by the tool the Host just started, not by the Bot alone: a Bot with a
    // group turn and a task turn running at once was impossible to attribute before.
    const turn = engine.resolveToolTurn(who?.id, name);
    // A Bot replying in several chats at once still cannot be attributed safely, unless the
    // tool the Host just started names the turn. Guessing is not an option.
    if (!turn && who && !who.external && engine.activeTurnCount(who.id) > 1) {
      throw new EngineError('busy', t('err.callerAmbiguous'));
    }
    const invocation = { turn, signal, toolPart: engine.bindToolPart(turn, name) };
    // The plugin's own rules, enforced where they cannot be argued with: the group carries
    // hand-overs only, a Bot does not open work of its own, and a Bot does not schedule itself.
    engine.guardToolCall(who, name, invocation);
    engine.setLive(invocation.turn, LIVE[name]?.(args ?? {}));
    try {
      const { value, event } = await runTool(name, args, who, invocation);
      if (event) engine.attachEvent(invocation.turn, event);
      return value;
    } catch (error) {
      // Only bounded, known business errors are safe to persist in the miniapp transcript.
      if (error instanceof MemoryError && ['memory_too_long', 'memory_full', 'memory_conflict', 'memory_topic_required', 'memory_backup_failed'].includes(error.code)) {
        const issue = { code: error.code };
        for (const field of ['max', 'actual', 'remaining', 'needed', 'shortfall', 'entryLimit', 'entryCount', 'entryNeeded', 'entryShortfall']) {
          if (Number.isFinite(error.details[field])) issue[field] = error.details[field];
        }
        for (const field of ['scope', 'key', 'entryId']) {
          if (typeof error.details[field] === 'string' && error.details[field].length <= 80) issue[field] = error.details[field];
        }
        engine.captureToolIssue(who?.id, name, issue, invocation);
      }
      throw error;
    } finally {
      engine.setLive(invocation.turn, undefined);
    }
  }

  /**
   * Turns the `model` a Bot names ("MiniMax-M3.1", "provider/model", a display name, or
   * "default") into a selection from the Host's catalog: `undefined` leaves it unchanged, `null`
   * puts the Bot back on the default model.
   */
  async function resolveModelArg(value) {
    if (value === undefined) return undefined;
    const text = String(value ?? '').trim();
    if (!text || /^(default|默认)$/i.test(text)) return null;
    const catalog = await engine.modelCatalog();
    if (!catalog) throw new EngineError('invalid', t('err.modelsUnsupported'));
    const wanted = text.toLowerCase();
    const models = catalog.models ?? [];
    const hit =
      models.find((m) => `${m.providerId}/${m.modelId}`.toLowerCase() === wanted) ??
      models.find((m) => m.modelId.toLowerCase() === wanted) ??
      models.find((m) => String(m.displayName ?? '').toLowerCase() === wanted);
    if (!hit) {
      const list = models.slice(0, 40).map((m) => `${m.providerId}/${m.modelId}`).join(', ');
      throw new EngineError('invalid', t('err.modelNotFound', { model: text, list }));
    }
    return toSelection(hit);
  }

  /** What a Bot may type for an effort, as the level names the catalog uses. */
  const EFFORT_ALIASES = {
    默认: 'default', 关闭: 'off', 关闭思考: 'off', 不思考: 'off', 低: 'low', 中: 'medium', 高: 'high', 很高: 'xhigh', 最高: 'max',
  };

  /**
   * The `model` / `effort` patch for create_bot and update_bot. An effort applies to the model the
   * Bot ends up on: its own (folded into that selection) or the default one (kept as `effort`).
   * Checked against what that model offers, so a Bot gets the valid choices back on a mistake.
   */
  async function resolveModelAndEffort(modelArg, effortArg, currentModel) {
    const model = await resolveModelArg(modelArg);
    if (effortArg === undefined) return model === undefined ? {} : { model, effort: null };
    const raw = String(effortArg ?? '').trim();
    const effort = EFFORT_ALIASES[raw] ?? raw.toLowerCase();
    const catalog = await engine.modelCatalog();
    if (!catalog) throw new EngineError('invalid', t('err.modelsUnsupported'));
    const target = model !== undefined ? model : currentModel;
    const entryFor = (sel) =>
      (catalog.models ?? []).find((m) => m.providerId === sel?.providerId && m.modelId === sel?.modelId);
    const entry = entryFor(target ?? catalog.default);
    const isDefault = !effort || effort === 'default';
    if (target) {
      if (isDefault) return { model: entry ? toSelection(entry) : target, effort: null };
      const sel = withEffort(entry, effort);
      if (!sel) throw new EngineError('invalid', t('err.badEffort', { effort: raw, model: target.modelId, list: effortOptions(entry).join(', ') || '-' }));
      return { model: sel, effort: null };
    }
    if (isDefault) return { ...(model === null ? { model } : {}), effort: null };
    if (!withEffort(entry, effort)) {
      throw new EngineError('invalid', t('err.badEffort', { effort: raw, model: catalog.default?.modelId ?? '-', list: effortOptions(entry).join(', ') || '-' }));
    }
    return { ...(model === null ? { model } : {}), effort };
  }

  /** @returns {Promise<{ value: unknown, event?: Record<string, unknown> }>} */
  async function runTool(name, args, who, invocation) {
    switch (name) {
      case 'list_team':
        return { value: team.teamSummary() };
      case 'message_bot': {
        const target = team.resolveBot(args.to);
        const receipt = await engine.tasks.dispatch(who, {
          request_id: args.request_id ?? newId('message'),
          tasks: [{ to: target.id, message: String(args.message ?? '') }],
        }, invocation);
        return { value: { ...receipt, from: target.name },
          event: { kind: 'asked', botId: target.id, text: String(args.message ?? '').slice(0, 400), reply: '' } };
      }
      case 'dispatch_tasks':
        return { value: await engine.tasks.dispatch(who, args, invocation) };
      case 'get_tasks':
        return { value: await engine.tasks.get(who, args) };
      case 'cancel_tasks':
        return { value: await engine.tasks.cancel(who, args) };
      case 'acknowledge_task':
        return { value: engine.tasks.acknowledge(who, args) };
      case 'post_group': {
        const group = team.resolveGroup(args.group);
        const receipt = await engine.tasks.dispatch(who, { ...args, request_id: args.request_id ?? newId('post') }, invocation, true);
        return {
          value: { ...receipt, posted_to: group.name, group_id: group.id,
            first_speaker: engine.groupQueue(group, String(args.message ?? '')).map((id) => store.getBot(id)?.name ?? id),
            note: t('mcp.postGroupNote', { name: group.name }) },
          event: { kind: 'group_posted', groupId: group.id, fromBotId: who?.id },
        };
      }
      case 'start_helper': {
        const helper = await engine.startHelper(who, { task: args.task, title: args.title }, invocation);
        return {
          value: { helper_id: helper.id, title: helper.title, status: helper.status, note: t('mcp.helperStartedNote') },
          event: { kind: 'helper_started', helperId: helper.id, title: helper.title },
        };
      }
      case 'list_helpers': {
        const now = Date.now();
        const mine = (store.state.helpers ?? []).filter((h) => !who || who.isMain || h.botId === who.id);
        return {
          value: mine.slice(-15).map((h) => ({
            helper_id: h.id,
            bot: store.getBot(h.botId)?.name ?? h.botId,
            title: h.title,
            status: h.status,
            seconds: Math.round(((h.endedAt ?? now) - (h.startedAt ?? h.createdAt)) / 1000),
            ...(h.report ? { report: h.report.slice(0, 1500) } : {}),
            ...(h.error ? { error: h.error } : {}),
          })),
        };
      }
      case 'stop_helper':
        return { value: engine.stopHelper(who, args.helper_id) };
      case 'list_agent_files':
        return { value: await team.listAgentFiles(who, { bot: args.bot }) };
      case 'read_agent_file':
        return { value: await team.readAgentFile(who, { bot: args.bot, name: args.name }) };
      case 'write_agent_file':
        return { value: await team.writeAgentFile(who, { bot: args.bot, name: args.name, text: args.text }) };
      case 'create_bot': {
        const bot = await team.createBot(who, {
          name: args.name,
          role: args.role,
          instructions: args.instructions,
          skin: args.skin,
          color: args.color,
          ...(await resolveModelAndEffort(args.model, args.effort, undefined)),
          avatar: args.avatar,
          autoHelper: args.auto_helper,
          isMain: args.main,
        });
        return { value: { created: bot.name, bot_id: bot.id }, event: { kind: 'bot_created', botId: bot.id } };
      }
      case 'update_bot': {
        const bot = await team.updateBot(who, args.bot, {
          name: args.name,
          role: args.role,
          instructions: args.instructions,
          skin: args.skin,
          color: args.color,
          ...(await resolveModelAndEffort(args.model, args.effort, team.resolveBot(args.bot).model)),
          avatar: args.avatar,
          autoHelper: args.auto_helper,
          isMain: args.main,
        });
        return { value: { updated: bot.name, bot_id: bot.id }, event: { kind: 'bot_updated', botId: bot.id } };
      }
      case 'delete_bot': {
        const value = await team.deleteBot(who, args.bot);
        return { value, event: { kind: 'bot_deleted', name: value.deleted } };
      }
      case 'create_group': {
        const group = await team.createGroup(who, {
          name: args.name,
          members: args.members,
          admin: args.admin,
          notice: args.notice,
          replyMode: args.reply_mode,
        });
        return { value: { created: group.name, group_id: group.id }, event: { kind: 'group_created', groupId: group.id } };
      }
      case 'update_group': {
        const group = await team.updateGroup(who, args.group, {
          name: args.name,
          notice: args.notice,
          members: args.members,
          admin: args.admin,
          replyMode: args.reply_mode,
        });
        return { value: { updated: group.name, group_id: group.id }, event: { kind: 'group_updated', groupId: group.id } };
      }
      case 'delete_group': {
        const value = await team.deleteGroup(who, args.group);
        return { value, event: { kind: 'group_deleted', name: value.deleted } };
      }
      case 'create_schedule': {
        const schedule = await team.createScheduleFor(who, {
          prompt: args.prompt,
          name: args.name,
          kind: args.kind,
          time: args.time,
          everyMinutes: args.every_minutes,
          inMinutes: args.in_minutes,
          targetBot: args.target_bot,
        });
        return {
          value: scheduleView(schedule),
          event: { kind: 'schedule_created', botId: schedule.botId, name: schedule.name, scheduleKind: schedule.kind, time: schedule.time, everyMinutes: schedule.everyMinutes, runAt: schedule.runAt },
        };
      }
      case 'list_schedules':
        return { value: team.visibleSchedules(who).map(scheduleView) };
      case 'delete_schedule': {
        const removed = await team.deleteScheduleFor(who, String(args.schedule_id ?? ''));
        return { value: { deleted: removed.name, schedule_id: removed.id }, event: { kind: 'schedule_deleted', name: removed.name } };
      }
      case 'host_memory_search':
        // The memory files of the Host are private to the Host, so they are read only when
        // the user has turned that access on. A tool list the Host cached earlier still
        // names the tool, so the call refuses it as well.
        if (!hostMemoryOn()) throw new EngineError('forbidden', t('mcp.err.hostMemoryOff'));
        return { value: await searchHostMemory(String(args.query ?? ''), { limit: args.limit }) };
      case 'memory_pending': {
        const entries = await engine.bridge.take(args.limit);
        // The text is the delivery: the caller puts it into its own conversation. The Host's
        // automatic capture only picks a conversation up once it has been quiet for 6 hours,
        // so the caller has to store the entry itself. That instruction travels with the
        // result, not only in the tool description the Host may have cached.
        const text = entries.map((entry) => '- [' + (entry.botName || entry.botId) + '] ' + entry.text).join('\n');
        const value = { count: entries.length, text, entries };
        if (entries.length) value.delivery = t('mcp.r.memoryPending');
        return { value };
      }
      default:
        throw new EngineError('unknown_tool', t('mcp.err.unknownTool', { name }));
    }
  }

  const calls = new Map();
  const sessions = new Set();

  /** @param {any} message */
  async function handleRpc(message, session) {
    if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') {
      return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
    }
    const { id, method, params } = message;
    const isNotification = id === undefined || id === null;
    try {
      let result;
      switch (method) {
        case 'initialize': {
          const requested = params?.protocolVersion;
          result = {
            protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: PLUGIN_ID, version: PLUGIN_VERSION },
            instructions: t('mcp.instructions'),
          };
          break;
        }
        case 'notifications/cancelled':
          if (session) calls.get(`${session}:${JSON.stringify(params?.requestId)}`)?.abort();
          return undefined;
        case 'ping':
          result = {};
          break;
        case 'tools/list':
          // The memory of the Host is private to the Host: while the access is off, the
          // tool is not offered at all.
          result = { tools: toolDefs().filter((tool) => tool.name !== 'host_memory_search' || hostMemoryOn()) };
          break;
        case 'tools/call': {
          const name = params?.name;
          const args = params?.arguments ?? {};
          if (!TOOL_NAMES.includes(name)) {
            return { jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${name}` } };
          }
          const tool = toolDefs().find((entry) => entry.name === name);
          const problems = schemaProblems(name, tool?.inputSchema, args);
          if (problems.length) {
            result = { content: [{ type: 'text', text: t('mcp.err.badArgs', { tool: name, problems }) }], isError: true };
            break;
          }
          const callKey = session ? `${session}:${JSON.stringify(id)}` : newId('rpc');
          if (calls.has(callKey)) return { jsonrpc: '2.0', id, error: { code: -32600, message: 'Request already running' } };
          const controller = new AbortController();
          calls.set(callKey, controller);
          try {
            const value = await callTool(name, args, controller.signal);
            result = { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
          } catch (error) {
            result = { content: [{ type: 'text', text: failureText(error, name) }], isError: true };
          } finally { calls.delete(callKey); }
          break;
        }
        default:
          if (isNotification) return undefined;
          return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
      }
      return isNotification ? undefined : { jsonrpc: '2.0', id, result };
    } catch (error) {
      if (isNotification) return undefined;
      return { jsonrpc: '2.0', id, error: { code: -32603, message: 'Internal error' } };
    }
  }

  /**
   * @param {import('node:http').IncomingMessage} request
   * @param {import('node:http').ServerResponse} response
   * @param {unknown} body
   */
  return async function handleMcp(request, response, body) {
    if (request.method === 'GET') {
      response.writeHead(405, { allow: 'POST' }).end();
      return;
    }
    if (request.method === 'DELETE') {
      sessions.delete(request.headers?.['mcp-session-id']);
      response.writeHead(200).end();
      return;
    }
    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'POST' }).end();
      return;
    }
    let session = request.headers?.['mcp-session-id'];
    if (session && !sessions.has(session)) { response.writeHead(404).end(); return; }
    if (!Array.isArray(body) && body?.method === 'initialize') {
      session = newId('mcp'); sessions.add(session); response.setHeader?.('mcp-session-id', session);
    }
    const batch = Array.isArray(body);
    const messages = batch ? body : [body];
    // Flush before executing long tools. Heartbeats prevent an idle HTTP body timeout;
    // they never renew the caller's own tool deadline. Disconnect only drops the observer.
    const streaming = String(request.headers?.accept ?? '').includes('text/event-stream') &&
      messages.some((message) => message?.method === 'tools/call' && message.id != null);
    let heartbeat;
    if (streaming) {
      response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' });
      response.flushHeaders();
      response.write(': connected\n\n');
      heartbeat = setInterval(() => { if (!response.destroyed) response.write(': keepalive\n\n'); }, 15000);
      heartbeat.unref?.();
      response.once('close', () => clearInterval(heartbeat));
    }
    try {
      const replies = (await Promise.all(messages.map((message) => handleRpc(message, session)))).filter((reply) => reply !== undefined);
      if (streaming) {
        if (!response.destroyed) {
          for (const reply of replies) response.write(`event: message\ndata: ${JSON.stringify(reply)}\n\n`);
          response.end();
        }
      } else if (replies.length === 0) response.writeHead(202).end();
      else {
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify(batch ? replies : replies[0]));
      }
    } finally { clearInterval(heartbeat); }
  };
}
