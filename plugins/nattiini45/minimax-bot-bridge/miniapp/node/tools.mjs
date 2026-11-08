/**
 * Access to the team's MCP tools.
 *
 * The bridge never hardcodes a tool's parameter names: it reads the live catalogue from
 * the Host (`context.tool.list()`), which reports each tool's `inputSchema`, and maps the
 * operation payload onto that schema. When a required property cannot be satisfied the
 * bridge refuses with `INVALID_ARGUMENTS` and returns the schema so the client can ask
 * for exactly the missing field instead of guessing.
 */

import { randomUUID } from 'node:crypto';

const TEAM_SERVER_HINT = 'minimax-bot';

/**
 * What the room is told when the team tools cannot be read.
 *
 * A fixed sentence, because this travels to every phone in the account and the Host's
 * own error text can name internal paths, tool identifiers and host-side detail.
 */
const TEAM_UNREADABLE = 'The @minimax-bot team tools could not be read. Open MiniMax Bot on this desktop to try again.';

/** Candidate property names for each operation field, most likely first. */
const ALIASES = {
  botId: ['botId', 'bot_id', 'target_bot', 'to', 'target', 'targetBotId', 'bot'],
  botIds: ['botIds', 'bot_ids', 'bots', 'to', 'targets'],
  text: ['text', 'message', 'content', 'prompt'],
  prompt: ['prompt', 'text', 'message', 'task', 'content', 'instruction'],
  title: ['title', 'name', 'subject'],
  taskId: ['taskId', 'task_id', 'id'],
  helperId: ['helperId', 'helper_id', 'id'],
  scheduleId: ['scheduleId', 'schedule_id', 'id', 'schedule'],
  turnId: ['turnId', 'turn_id', 'id', 'sessionId'],
  task: ['task', 'prompt', 'message', 'content', 'instruction', 'description'],
  id: ['id', 'memoryId', 'entryId', 'scheduleId', 'groupId', 'botId'],
  groupId: ['groupId', 'group_id', 'group', 'id'],
  query: ['query', 'q', 'search', 'text'],
  limit: ['limit', 'count', 'max', 'top'],
  days: ['days', 'span', 'range'],
  name: ['name', 'title'],
  memberIds: ['memberIds', 'member_ids', 'members', 'bots'],
  admin: ['admin', 'adminBotId', 'admin_bot_id'],
  notice: ['notice', 'description'],
  replyMode: ['replyMode', 'reply_mode', 'mode'],
  skin: ['skin', 'look', 'avatar'],
  color: ['color', 'colour'],
  model: ['model', 'modelId', 'model_id'],
  role: ['role', 'title', 'description'],
  instructions: ['instructions', 'prompt', 'systemPrompt', 'persona'],
  main: ['main', 'isMain', 'is_main'],
  kind: ['kind', 'type', 'scheduleKind', 'schedule_kind'],
  spec: ['spec', 'time', 'at', 'everyMinutes', 'every_minutes', 'cron', 'schedule'],
  targetBotId: ['targetBotId', 'target_bot_id', 'target_bot', 'botId', 'bot_id', 'to'],
  enabled: ['enabled', 'active'],
  chatId: ['chatId', 'chat_id'],
  mentions: ['mentions', 'mentionIds', 'at'],
  attachments: ['attachments', 'files'],
  requestId: ['requestId', 'request_id', 'id'],
  decision: ['decision', 'action'],
  answers: ['answers', 'answer'],
  messageId: ['messageId', 'message_id', 'id'],
  emoji: ['emoji', 'reaction'],
  role_: ['role', 'title'],
  key: ['key', 'topic', 'topicKey'],
  replaceId: ['replaceId', 'replace_id', 'entryId'],
  batchId: ['batchId', 'batch_id'],
  waitMs: ['waitMs', 'wait_ms'],
  resultOffset: ['resultOffset', 'result_offset'],
  scope: ['scope'],
  pinned: ['pinned'],
  source: ['source'],
};

/**
 * Properties the team fills in itself.
 *
 * Every team tool advertises `caller_bot_id`, and some of them list it as required,
 * but the server is the one that knows which Bot is calling. The bridge never sends
 * it, so it is never treated as a missing argument.
 */
const SERVER_SUPPLIED = ['caller_bot_id'];

/**
 * The first of several candidate fields that carries text.
 *
 * @param {...unknown} values
 * @returns {string | undefined}
 */
function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * The first of several candidate fields that carries a number.
 *
 * @param {...unknown} values
 * @returns {number | undefined}
 */
function firstNumber(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

/**
 * A list of Bot ids from any of the shapes the operation payload may use.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
function toBotList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry ?? '').trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

/**
 * Builds the arguments for the task dispatcher.
 *
 * The dispatcher does not take a Bot and a prompt: it takes a *list* of tasks, each
 * with its own recipient and message, plus an idempotency key. That list is the one
 * thing a flat property mapping cannot express, so the dispatch is built here.
 *
 * @param {Record<string, unknown>} payload
 * @returns {Record<string, unknown>}
 */
function buildDispatchArguments(payload) {
  const botIds = toBotList(payload.botIds ?? payload.bot_ids ?? payload.bots ?? payload.to);
  if (botIds.length === 0) {
    throw new ToolArgumentError('A dispatch needs at least one Bot to hand the work to.', {
      field: 'botIds',
      missing: ['botIds'],
      required: ['request_id', 'tasks'],
      properties: ['botIds', 'prompt', 'title'],
    });
  }
  const prompt = firstText(payload.prompt, payload.text, payload.message, payload.task);
  if (!prompt) {
    throw new ToolArgumentError('A dispatch needs the text the Bot is to work on.', {
      field: 'prompt',
      missing: ['prompt'],
      required: ['request_id', 'tasks'],
      properties: ['botIds', 'prompt', 'title'],
    });
  }
  const title = firstText(payload.title, payload.name, payload.subject);
  const requestId = firstText(payload.requestId, payload.request_id);
  return {
    request_id: requestId ?? `phone-${randomUUID()}`,
    tasks: botIds.map((to) => ({ to, message: prompt, ...(title ? { title } : {}) })),
  };
}

/**
 * Builds the arguments for a task query.
 *
 * The team's task tool answers for one batch or one task at a time; there is no
 * "list everything" call, and it refuses a query that names both.
 *
 * @param {Record<string, unknown>} payload
 * @returns {Record<string, unknown>}
 */
function buildTaskQueryArguments(payload) {
  /** @type {Record<string, unknown>} */
  const args = {};
  const taskId = firstText(payload.taskId, payload.task_id);
  const batchId = firstText(payload.batchId, payload.batch_id);
  if (taskId) args.task_id = taskId;
  if (batchId) args.batch_id = batchId;
  const waitMs = firstNumber(payload.waitMs, payload.wait_ms);
  if (waitMs !== undefined) args.wait_ms = waitMs;
  const resultOffset = firstNumber(payload.resultOffset, payload.result_offset);
  if (resultOffset !== undefined) args.result_offset = resultOffset;
  return args;
}

/**
 * Builds the arguments for the memory tool.
 *
 * A memory is either filed under a topic or replaces an existing entry, so the
 * tool takes a topic key and an entry id under their own names. The target Bot is
 * the tool's `target_bot`, not a `bot_id`.
 *
 * @param {Record<string, unknown>} payload
 * @returns {Record<string, unknown>}
 */
function buildRememberArguments(payload) {
  /** @type {Record<string, unknown>} */
  const args = {};
  const text = firstText(payload.text, payload.message, payload.content);
  if (text) args.text = text;
  const botId = firstText(payload.botId, payload.bot_id, payload.targetBotId, payload.target_bot);
  if (botId) args.target_bot = botId;
  const key = firstText(payload.key, payload.topic, payload.topicKey);
  if (key) args.key = key;
  const replaceId = firstText(payload.replaceId, payload.replace_id, payload.entryId);
  if (replaceId) args.replace_id = replaceId;
  const scope = firstText(payload.scope);
  if (scope) args.scope = scope;
  if (typeof payload.pinned === 'boolean') args.pinned = payload.pinned;
  const source = firstText(payload.source);
  if (source) args.source = source;
  return args;
}

/**
 * The text of a tool's own error message.
 *
 * A tool that ran and failed says so in its content. Keeping that text is what lets
 * the phone tell the user what the team actually said.
 *
 * @param {unknown} content
 * @returns {string | undefined}
 */
function errorText(content) {
  if (!Array.isArray(content)) return undefined;
  for (const part of content) {
    if (part && typeof part.text === 'string' && part.text.trim()) return part.text.trim();
  }
  return undefined;
}

/**
 * The tools whose arguments are not a flat property mapping.
 *
 * @type {Record<string, (payload: Record<string, unknown>) => Record<string, unknown>>}
 */
const TOOL_ARG_BUILDERS = {
  dispatch_tasks: buildDispatchArguments,
  get_tasks: buildTaskQueryArguments,
  cancel_tasks: buildTaskQueryArguments,
  remember: buildRememberArguments,
};

/**
 * Which team tool backs each operation.
 *
 * The table lives in the shared protocol package — the same one the client and the relay
 * read — so the three runtimes cannot drift apart. It is vendored into the plugin
 * artifact by `scripts/sync-protocol.mjs`, because a Mini App runs with no module
 * resolution.
 */
export { OP_TOOL } from './protocol/index.js';

export class ToolArgumentError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'ToolArgumentError';
    this.code = 'INVALID_ARGUMENTS';
    this.details = details;
  }
}

/**
 * Whether a value fits a JSON Schema property.
 *
 * An unknown type keyword never blocks a call: the live schema may use constructs
 * this check does not model, and refusing on them would break working tools.
 */
function matchesType(value, schema) {
  if (!schema || typeof schema !== 'object') return true;

  const declared = schema.type;
  if (declared) {
    const types = Array.isArray(declared) ? declared : [declared];
    const ok = types.some((type) => {
      switch (type) {
        case 'string':
          return typeof value === 'string';
        case 'number':
          return typeof value === 'number' && Number.isFinite(value);
        case 'integer':
          return Number.isInteger(value);
        case 'boolean':
          return typeof value === 'boolean';
        case 'array':
          return Array.isArray(value);
        case 'object':
          return value !== null && typeof value === 'object' && !Array.isArray(value);
        default:
          return true;
      }
    });
    if (!ok) return false;
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false;

  // The range a tool declares is part of its contract: the memory tool refuses a
  // page of more than twenty entries, and the caller should hear that from the
  // bridge — with the range in the message — rather than from the team's own error.
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) return false;
    if (typeof schema.maximum === 'number' && value > schema.maximum) return false;
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) return false;
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) return false;
  }

  return true;
}

/**
 * Maps an operation payload onto a tool's input schema.
 *
 * When the schema is unknown the payload is passed through untouched, which is correct
 * for tools that take a single argument bag.
 *
 * A payload field is only ever written onto a property that accepts its type: the
 * alias list is walked in order and the first candidate whose type fits wins. If a
 * candidate exists but the value does not fit it, that is a real mismatch and is
 * reported — the field is never silently dropped, because a dropped field turns
 * into a tool call with the wrong arguments.
 *
 * A few tools take arguments that are not properties of the payload at all — the task
 * dispatcher takes a list of tasks, the memory tool a topic key. Those are built by
 * the tool's own builder, and the schema is then used to check what they produced.
 *
 * @param {Record<string, unknown>} payload
 * @param {any} schema
 * @param {string} [toolName]
 */
export function buildToolArguments(payload, schema, toolName) {
  const builder = toolName ? TOOL_ARG_BUILDERS[toolName] : undefined;
  if (builder) {
    const args = builder(payload ?? {});
    assertArgumentTypes(schema, args);
    assertRequirements(schema, args, {});
    return args;
  }

  const properties = schema && typeof schema === 'object' ? schema.properties : undefined;
  if (!properties || typeof properties !== 'object') {
    return { ...payload };
  }

  const used = new Set();
  /** @type {Record<string, unknown>} */
  const args = {};
  /** @type {string[]} */
  const unmapped = [];

  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) continue;
    const candidates = ALIASES[key] ?? [key];
    const target = candidates.find(
      (candidate) =>
        candidate in properties && !used.has(candidate) && matchesType(value, properties[candidate]),
    );
    if (target) {
      args[target] = value;
      used.add(target);
      continue;
    }

    // A candidate exists but rejects the value's type. Say so instead of dropping it.
    const mismatched = candidates.find(
      (candidate) => candidate in properties && !used.has(candidate),
    );
    if (mismatched) {
      throw new ToolArgumentError(
        `"${key}" does not fit "${mismatched}" (${describeType(properties[mismatched])}${describeRange(properties[mismatched])}).`,
        {
          field: key,
          target: mismatched,
          expected: `${describeType(properties[mismatched])}${describeRange(properties[mismatched])}`,
          missing: [],
          required: Array.isArray(schema.required) ? schema.required : [],
          properties: Object.keys(properties),
        },
      );
    }

    unmapped.push(key);
  }

  // Properties the schema wants but the payload did not carry are left out on purpose:
  // the tool decides whether they are required.

  assertRequirements(schema, args, { unmapped });

  return args;
}

/**
 * Checks that every value a builder produced fits the property it was written to.
 *
 * @param {any} schema
 * @param {Record<string, unknown>} args
 */
function assertArgumentTypes(schema, args) {
  const properties = schema && typeof schema === 'object' ? schema.properties : undefined;
  if (!properties || typeof properties !== 'object') return;
  for (const [key, value] of Object.entries(args)) {
    const property = properties[key];
    if (!property) continue;
    if (matchesType(value, property)) continue;
    throw new ToolArgumentError(
      `"${key}" does not fit "${key}" (${describeType(property)}${describeRange(property)}).`,
      {
        field: key,
        target: key,
        expected: `${describeType(property)}${describeRange(property)}`,
        missing: [],
        required: Array.isArray(schema.required) ? schema.required : [],
        properties: Object.keys(properties),
      },
    );
  }
}

/**
 * Checks what the schema requires, including the requirements it states conditionally.
 *
 * The team's task tool says "a task id or a batch id, not both" and its memory tool
 * says "a topic key or the entry to replace". Neither is a plain `required` list, so
 * without this the call would leave and come back with the server's own wording.
 *
 * @param {any} schema
 * @param {Record<string, unknown>} args
 * @param {{unmapped?: string[]}} [extra]
 */
function assertRequirements(schema, args, extra = {}) {
  const properties = schema && typeof schema === 'object' ? schema.properties : undefined;
  const required = Array.isArray(schema?.required) ? schema.required : [];
  const missing = required.filter(
    (property) => !(property in args) && !SERVER_SUPPLIED.includes(property),
  );
  if (missing.length > 0) {
    throw new ToolArgumentError(
      `Missing required argument${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`,
      {
        missing,
        required,
        unmapped: extra.unmapped ?? [],
        properties: properties ? Object.keys(properties) : [],
      },
    );
  }

  for (const [keyword, mode] of [['anyOf', 'any'], ['oneOf', 'one']]) {
    const branches = schema?.[keyword];
    if (!Array.isArray(branches)) continue;
    const satisfied = branches.filter((branch) =>
      requiredNames(branch).every((name) => name in args),
    );
    const names = branchNames(branches);
    if (mode === 'any' && satisfied.length === 0) {
      throw new ToolArgumentError(
        `One of ${names.join(', ')} is required.`,
        {
          missing: names,
          required,
          unmapped: extra.unmapped ?? [],
          properties: properties ? Object.keys(properties) : [],
        },
      );
    }
    if (mode === 'one' && satisfied.length !== 1) {
      throw new ToolArgumentError(
        `Exactly one of ${names.join(', ')} is required.`,
        {
          missing: satisfied.length === 0 ? names : [],
          required,
          unmapped: extra.unmapped ?? [],
          properties: properties ? Object.keys(properties) : [],
        },
      );
    }
  }
}

/** The properties a schema branch requires. */
function requiredNames(branch) {
  return Array.isArray(branch?.required) ? branch.required : [];
}

/** Every property named by a set of schema branches. */
function branchNames(branches) {
  const names = new Set();
  for (const branch of branches) {
    for (const name of requiredNames(branch)) names.add(name);
  }
  return [...names];
}

/** A short human description of a schema property, for error messages. */
function describeType(property) {
  if (!property || typeof property !== 'object') return 'unknown';
  const declared = property.type;
  if (Array.isArray(declared)) return declared.join(' | ');
  if (typeof declared === 'string') return declared;
  if (Array.isArray(property.enum)) return `one of ${property.enum.join(', ')}`;
  return 'unknown';
}

/** The range a schema property accepts, for error messages. */
function describeRange(property) {
  if (!property || typeof property !== 'object') return '';
  const { minimum, maximum, minLength, maxLength } = property;
  if (typeof minimum === 'number' && typeof maximum === 'number') return ` between ${minimum} and ${maximum}`;
  if (typeof maximum === 'number') return ` at most ${maximum}`;
  if (typeof minimum === 'number') return ` at least ${minimum}`;
  if (typeof maxLength === 'number') return ` of at most ${maxLength} characters`;
  if (typeof minLength === 'number') return ` of at least ${minLength} characters`;
  return '';
}

export class ToolGateway {
  /**
   * @param {import('./contracts.d.ts').HostContext} context the Mini App context
   */
  constructor(context) {
    this.context = context;
    /** @type {Array<{name: string, server: string, tool: string, description?: string, inputSchema?: unknown}>} */
    this.catalog = [];
    this.partial = false;
    this.available = false;
    /**
     * The sentence the room is told.
     *
     * It is a fixed sentence and not the Host's own error text: this travels to every
     * phone in the account, and the Host's message can name internal paths, tool
     * identifiers and host-side detail that the phone's users did not need to see.
     * The detail is kept in `detail` for the desktop.
     *
     * @type {string | undefined}
     */
    this.reason = undefined;
    /**
     * The detail behind the sentence, for the desktop's own logs and surface.
     *
     * @type {string | undefined}
     */
    this.detail = undefined;
  }

  /** Reads the live tool catalogue. Never throws: an unavailable team is a state, not a crash. */
  async refresh() {
    const tool = this.context.tool;
    if (!tool || typeof tool.list !== 'function') {
      this.available = false;
      this.reason = 'This Mini App was not granted tool access.';
      this.detail = undefined;
      this.catalog = [];
      return this;
    }
    try {
      const result = await tool.list();
      this.catalog = (result.tools ?? []).filter((entry) => this.isTeamTool(entry));
      this.partial = result.partial === true;
      this.available = this.catalog.length > 0;
      this.reason = this.available
        ? undefined
        : 'The @minimax-bot team is not running. Open MiniMax Bot on this desktop to link it.';
      this.detail = undefined;
    } catch (error) {
      this.available = false;
      this.catalog = [];
      this.detail = error instanceof Error ? error.message : String(error);
      this.reason = TEAM_UNREADABLE;
      // The detail is written down here, on the desktop, where the person who can do
      // something about it will find it.
      this.context.logger?.warn?.('the team tool catalogue could not be read', { message: this.detail });
    }
    return this;
  }

  /** @param {Partial<import('./protocol/types.js').ToolDescriptor>} entry
   * @returns {entry is import('./protocol/types.js').ToolDescriptor} */
  isTeamTool(entry) {
    if (!entry || typeof entry.server !== 'string' || typeof entry.name !== 'string'
        || typeof entry.tool !== 'string' || !entry.tool) return false;
    const server = entry.server.toLowerCase();
    const name = entry.name.toLowerCase();
    // Both identities must agree. A helper server is not the canonical team,
    // even when its name contains "minimax-bot" or it exports the same tool.
    return server === TEAM_SERVER_HINT
      && name === `mcp__${TEAM_SERVER_HINT}__${entry.tool.toLowerCase()}`;
  }

  /** Finds a uniquely identified team tool; ambiguous catalogues fail closed. */
  find(toolName) {
    const matches = this.catalog.filter((entry) => entry.tool === toolName);
    return matches.length === 1 ? matches[0] : undefined;
  }

  /**
   * Calls a team tool by its short name.
   *
   * @returns {Promise<{ok: boolean, content?: unknown, structuredContent?: unknown, isError?: boolean, code?: string, disposition?: string, details?: unknown, message?: string}>}
   */
  async call(toolName, payload, options = {}) {
    const descriptor = this.find(toolName);
    if (!descriptor) {
      return { ok: false, code: 'TOOL_NOT_AVAILABLE', disposition: 'not_dispatched' };
    }

    let args;
    try {
      args = buildToolArguments(payload, descriptor.inputSchema, toolName);
    } catch (error) {
      if (error instanceof ToolArgumentError) {
        return {
          ok: false,
          code: error.code,
          disposition: 'not_dispatched',
          message: error.message,
          details: error.details,
        };
      }
      throw error;
    }

    // The Host's tool API is positional: `call(name, arguments, options?)`. Passing an
    // object instead leaves the Host with an undefined tool name, and it answers
    // "Mini App tool name or arguments are invalid" for every call.
    const result = await this.context.tool.call(
      descriptor.name,
      args,
      options.signal ? { signal: options.signal } : undefined,
    );

    if (!result || result.kind !== 'mcp') {
      return {
        ok: false,
        code: 'MCP_TOOL_FAILED',
        disposition: 'unknown_after_dispatch',
        message: `The team tool ${toolName} did not return an MCP result.`,
      };
    }

    if (result.isError === true) {
      // The tool ran and reported its own failure. That is a completed call with an
      // error payload, not a refused call, so the bridge reports it as one — with the
      // tool's own wording, which is the difference between "something went wrong"
      // and "the query must not be empty".
      return {
        ok: true,
        isError: true,
        content: result.content,
        structuredContent: result.structuredContent,
        message: errorText(result.content) ?? `The ${toolName} tool reported an error.`,
      };
    }

    return {
      ok: true,
      isError: false,
      content: result.content,
      structuredContent: result.structuredContent,
    };
  }
}
