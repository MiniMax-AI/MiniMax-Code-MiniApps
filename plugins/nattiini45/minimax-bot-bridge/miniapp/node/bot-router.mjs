/**
 * Routes a phone's turn to the Bot it was addressed to.
 *
 * The bridge used to hand every message to the Host's general assistant, so picking a
 * Bot on the phone changed nothing but the colour of the bubble. A turn now goes to
 * the Bot the phone picked, and it can go two ways:
 *
 * - **team** — the `@minimax-bot` team runs it: `message_bot` for a Bot's own chat,
 *   `post_group` for a group. The Bot answers with its own instructions, model and
 *   effort, in its own session, and its reply lands in its own conversation.
 * - **hosted** — the desktop runs it under the bridge, in that Bot's own session. The
 *   Host only lets the Mini App that owns a run answer its questions, so this is where
 *   a permission check or a questionnaire the Bot raises can be answered from the phone.
 *
 * A group is always the team's: who speaks first, who the admin is and who hands over
 * to whom are the product's rules, and the bridge does not make them up.
 *
 * The team is reached through the Host's tool API — the same channel the roster
 * already uses — because that is where the official plugin exposes its engine. The
 * team answers a turn with a durable receipt and finishes it later, so the bridge asks
 * for the result until the task settles. Nothing here is invented: the reply is the
 * Bot's own text, and a task that fails is reported as a failure.
 */

import { CHAT_ROUTING } from './protocol/index.js';
import { buildBotBrief } from './bot-brief.mjs';
import { ModelPicker } from './bot-model.mjs';

/** The prefix of a chat id that names one Bot's own conversation. */
export const BOT_CHAT_PREFIX = 'bot:';

/** The prefix of a chat id that names a group conversation. */
export const GROUP_CHAT_PREFIX = 'group:';

/**
 * How long the team is asked to hold a task query before it answers.
 *
 * The team's own limit is twenty seconds; asking for the same window means the bridge
 * waits for a state change instead of polling the team in a tight loop.
 */
const QUERY_WAIT_MS = 20000;

/**
 * The task statuses that will not change on their own.
 *
 * `waiting_for_user` and `paused` are settled as far as the phone is concerned: the
 * turn is over until the user acts, and the phone is told what to do about it.
 */
const SETTLED = new Set(['done', 'failed', 'unknown', 'cancelled', 'waiting_for_user', 'paused']);

/**
 * How many phone conversations the bridge keeps a session for.
 *
 * A phone's conversation lives in the Host's session it ran in, and the bridge keeps
 * the name of it. The chat id is chosen by the client, so this is a ceiling and not a
 * promise.
 */
const MAX_PHONE_SESSIONS = 64;

export class BotRouter {
  /**
   * @param {import('./contracts.d.ts').HostContext} context the Mini App context
   * @param {object} options
   * @param {import('./tools.mjs').ToolGateway} [options.gateway] the team tool gateway
   * @param {() => Promise<{bots?: Array<{botId?: string, name?: string}>}>} [options.roster]
   *   the team roster, used to name a mention the way the team reads it
   */
  constructor(context, { gateway, roster } = {}) {
    this.context = context;
    this.gateway = gateway;
    this.roster = roster ?? (async () => ({ bots: [] }));
    /** The model a hosted turn runs on, picked the way the product picks it. */
    this.models = new ModelPicker(context);
    /**
     * The Host session each phone conversation runs in.
     *
     * A phone's conversation is its own: it does not continue the session the desktop
     * last used, because that session belongs to whatever the user was doing on the
     * desktop.
     *
     * @type {Map<string, string>}
     */
    this.phoneSessions = new Map();
    /** @type {Map<string, {batchId: string, taskId?: string, chatId: string}>} */
    this.turns = new Map();
    this.polls = new Map();
    /** Per-chat tails hold the session-establishing run, not just its start call. */
    /** @type {Map<string, Promise<void>>} */
    this.hostedQueues = new Map();
    this.hostedCount = 0;
  }

  /** Whether a turn can be handed to the team right now. */
  get available() {
    return Boolean(this.gateway?.available);
  }

  /**
   * Which team tool runs a turn in this chat, and who it is for.
   *
   * @param {string} chatId
   * @returns {{tool: string, kind: 'bot' | 'group', targetId: string} | undefined}
   */
  route(chatId) {
    const id = String(chatId ?? '');
    for (const [prefix, tool] of Object.entries(CHAT_ROUTING)) {
      if (id.startsWith(prefix)) {
        return {
          tool,
          kind: prefix === BOT_CHAT_PREFIX ? 'bot' : 'group',
          targetId: id.slice(prefix.length),
        };
      }
    }
    return undefined;
  }

  /**
   * Runs a turn in the Bot's own session, with the bridge owning the run.
   *
   * The team runs a turn in the Bot's session but keeps the run to itself, so a
   * permission check or a questionnaire raised by that Bot is answered in the desktop
   * Bot app and not from the phone. A run the bridge owns is the only one the phone can
   * answer, because the Host's agent API lets the Mini App that started a run see its
   * questions and answer them.
   *
   * The Bot is still the Bot: the brief carries its name, role and instructions, the
   * model is the Bot's own, and the conversation is the phone's own — a session the
   * bridge keeps for this chat, not the session the desktop last used. The desktop's
   * session belongs to whatever the user was doing on the desktop: a phone message
   * dropped into it is answered in the middle of that conversation, which is how a
   * short message from the phone comes back as a repeat of an earlier answer, with the
   * state that was true when that answer was written.
   *
   * @param {{chatId: string, botId: string, text: string, onEvent?: (event: any) => void, signal?: AbortSignal}} input
   */
  hosted(input) {
    return this.inHostedChat(input.chatId, () => this.hostedTurn(input), input.signal);
  }

  /**
   * Serialize a chat through result/session installation. Different chats remain
   * parallel; queued work is bounded and checks its owning signal before admission.
   */
  async inHostedChat(chatId, execute, signal) {
    signal?.throwIfAborted();
    if (this.hostedCount >= 32) throw codedError('BUSY', 'Too many hosted turns are already waiting.', true);
    this.hostedCount += 1;
    const previous = this.hostedQueues.get(chatId) ?? Promise.resolve();
    const work = previous.then(() => { signal?.throwIfAborted(); return execute(); });
    const tail = work.then(() => {}, () => {});
    this.hostedQueues.set(chatId, tail);
    try { return await work; } finally {
      this.hostedCount -= 1;
      if (this.hostedQueues.get(chatId) === tail) this.hostedQueues.delete(chatId);
    }
  }

  /** @param {{chatId: string, botId: string, text: string, onEvent?: (event: any) => void, signal?: AbortSignal}} input */
  async hostedTurn({ chatId, botId, text, onEvent, signal }) {
    if (!this.context.agent) {
      throw codedError(
        'AGENT_UNAVAILABLE',
        'The desktop agent is not available, so the Bot cannot be run from here.',
        true,
      );
    }
    signal?.throwIfAborted();
    const bot = (await this.roster())?.bots?.find((entry) => entry?.botId === botId);
    signal?.throwIfAborted();
    if (!bot) {
      throw codedError('NOT_FOUND', 'This Bot is not on the team.');
    }
    // The phone's own conversation with this Bot. It starts empty and grows with what
    // the phone says; the desktop's session is not part of it.
    const sessionId = this.phoneSessions.get(chatId);
    // The Bot's own model, at its own effort, resolved out of the Host's catalog: the
    // roster names the model as text, while the run takes a selection.
    const model = await this.models.selectionFor(bot);
    signal?.throwIfAborted();
    let result;
    try {
      result = await this.context.agent.run(
        {
          text: buildBotBrief(bot, text),
          ...(sessionId ? { sessionId } : {}),
          ...(model ? { model } : {}),
        },
        { signal, onEvent },
      );
    } catch (error) {
      // The Host rejects a model it no longer offers before the turn starts; say which
      // setting to fix rather than reporting a turn that never began as a broken run.
      if (model && errorCode(error) === 'INVALID_ARGUMENTS') {
        throw codedError(
          'MODEL_UNAVAILABLE',
          `This Bot's model is not available on this desktop any more: ${model.modelId}.`,
          false,
        );
      }
      throw error;
    }
    // The Host names the session the turn ran in; the next turn of this chat continues it.
    if (!signal?.aborted && result?.sessionId) this.rememberPhoneSession(chatId, result.sessionId);
    return {
      status: result?.status ?? 'finished',
      text: result?.text ?? '',
      sessionId: result?.sessionId ?? sessionId,
      turnId: result?.turnId,
      pendingQuestion: result?.pendingQuestion,
      error: result?.error,
      usage: result?.usage,
    };
  }

  /**
   * Remembers the session a phone's conversation runs in.
   *
   * The chat id is chosen by the client, so the number of sessions the bridge keeps is
   * a ceiling and not a promise: the least recently used chat goes first.
   *
   * @param {string} chatId
   * @param {string} sessionId
   */
  rememberPhoneSession(chatId, sessionId) {
    if (!chatId || !sessionId) return;
    this.phoneSessions.set(chatId, sessionId);
    while (this.phoneSessions.size > MAX_PHONE_SESSIONS) {
      const oldest = this.phoneSessions.keys().next();
      if (oldest.done) break;
      this.phoneSessions.delete(oldest.value);
    }
  }

  /**
   * Hands the turn to the Bot or the group it was addressed to.
   *
   * @param {{chatId: string, text: string, mentions?: string[], requestId?: string, signal?: AbortSignal}} input
   * @returns {Promise<{batchId: string, taskId?: string, tool: string, kind: string, targetId: string, chatId: string}>}
   */
  async send({ chatId, text, mentions, requestId, signal }) {
    signal?.throwIfAborted();
    const route = this.route(chatId);
    if (!route) {
      throw codedError(
        'INVALID_ARGUMENTS',
        'This conversation does not belong to a Bot or a group, so there is nobody to answer.',
      );
    }
    if (!this.available) {
      throw codedError(
        'TEAM_UNAVAILABLE',
        'The @minimax-bot team is not running on this desktop. Open MiniMax Bot to link it.',
        true,
      );
    }

    // The team reads a mention as a name, not as an id, so the ids the phone sends are
    // translated before the text goes out. A mention of a Bot the roster does not know
    // is dropped: the team would ignore it anyway.
    const body =
      route.kind === 'group' ? await this.withMentions(text, mentions) : String(text ?? '');

    const payload =
      route.kind === 'group'
        ? { groupId: route.targetId, text: body, requestId }
        : { botId: route.targetId, text: body, requestId };

    // Stop may invalidate local admission while a mention lookup is pending. Do
    // not forward this signal to the mutation: stopping observation does not
    // authorize cancelling official work once the team has accepted it.
    signal?.throwIfAborted();
    const result = await this.gateway.call(route.tool, payload);
    if (!result.ok) {
      throw codedError(
        result.code ?? 'TEAM_UNAVAILABLE',
        result.message ?? 'The team did not take the message.',
        result.disposition !== 'not_dispatched',
      );
    }
    if (result.isError === true) {
      throw codedError('TEAM_ERROR', result.message ?? 'The team refused the message.', true);
    }

    const receipt = readReceipt(result);
    const taskId = receipt.tasks?.[0]?.task_id;
    const batchId = String(receipt.batch_id ?? '');
    if (!batchId) {
      throw codedError('TEAM_ERROR', 'The team did not return a task for the message.', true);
    }
    const turn = { batchId, taskId, chatId, tool: route.tool, kind: route.kind, targetId: route.targetId };
    this.turns.set(turnIdOf(turn), turn);
    return turn;
  }

  /**
   * Waits for the task to settle and reports what the Bot said.
   *
   * @param {{batchId: string, taskId?: string, chatId: string}} turn
   * @param {{signal?: AbortSignal}} [options]
   */
  async wait(turn, { signal } = {}) {
    const key = turnIdOf(turn);
    this.polls.set(key, (this.polls.get(key) ?? 0) + 1);
    try {
      return await this.poll(turn, { signal });
    } finally {
      const remaining = (this.polls.get(key) ?? 1) - 1;
      if (remaining > 0) this.polls.set(key, remaining);
      else {
        this.polls.delete(key);
        this.turns.delete(key);
      }
    }
  }

  /** @param {{batchId: string, taskId?: string, chatId: string}} turn @param {{signal?: AbortSignal}} [options] */
  async poll(turn, { signal } = {}) {
    /** @type {string} */
    let text = '';
    let task;
    let offset = 0;
    for (;;) {
      if (signal?.aborted) throw codedError('CANCELLED', 'The turn was stopped.');
      const result = await this.gateway.call(
        'get_tasks',
        {
          ...(turn.taskId ? { taskId: turn.taskId } : { batchId: turn.batchId }),
          waitMs: QUERY_WAIT_MS,
          resultOffset: offset,
        },
        signal ? { signal } : {},
      );
      if (!result.ok) {
        throw codedError(
          result.code ?? 'TEAM_UNAVAILABLE',
          result.message ?? 'The team did not report the result.',
          true,
        );
      }
      if (result.isError === true) {
        throw codedError('TEAM_ERROR', result.message ?? 'The team could not report the result.', true);
      }

      const view = readReceipt(result);
      task = view.tasks?.[0];
      if (!task) {
        throw codedError('TEAM_ERROR', 'The team reported no task for the message.', true);
      }
      if (typeof task.result === 'string') text += task.result;
      // A long reply arrives in pages; the offset says whether more is waiting.
      const next = task.next_result_offset;
      if (typeof next === 'number' && next > offset) {
        offset = next;
        continue;
      }
      if (!SETTLED.has(String(task.status))) {
        // Still running: ask again and let the team hold the query.
        continue;
      }
      break;
    }

    const status = String(task.status);
    if (status === 'done') {
      return {
        status: 'finished',
        text,
        sessionId: task.session_id,
        messageId: task.result_message_id,
        // The task the turn ran under. The desktop names its own record of that turn
        // after it, so it is what finds the exchange the desktop recorded.
        taskId: task.task_id,
        botId: task.bot_id,
        chatId: task.chat_id ?? turn.chatId,
      };
    }
    if (status === 'cancelled') {
      return { status: 'cancelled', text, taskId: task.task_id, chatId: turn.chatId };
    }
    if (status === 'waiting_for_user') {
      return {
        status: 'waiting_for_user',
        text,
        taskId: task.task_id,
        chatId: turn.chatId,
        note: 'The Bot is waiting for an answer. Open MiniMax Bot on the desktop to answer it.',
      };
    }
    if (status === 'paused') {
      return {
        status: 'paused',
        text,
        taskId: task.task_id,
        chatId: turn.chatId,
        note: 'The group paused the discussion. Send another message to continue it.',
      };
    }
    throw codedError(
      'TURN_FAILED',
      task.error ? `The Bot could not finish the turn: ${task.error}` : 'The Bot could not finish the turn.',
      true,
    );
  }

  /**
   * Stops a running turn.
   *
   * @param {{batchId: string, taskId?: string}} turn
   */
  async cancel(turn) {
    const result = await this.gateway.call('cancel_tasks', {
      ...(turn.taskId ? { taskId: turn.taskId } : { batchId: turn.batchId }),
    });
    if (!result.ok || result.isError === true || readReceipt(result)?.ok === false) {
      throw codedError(
        result.code ?? 'TEAM_ERROR',
        result.message ?? readReceipt(result)?.error ?? 'The team did not stop the turn.',
        true,
      );
    }
    const tasks = readReceipt(result).tasks;
    const completedBeforeCancel = Array.isArray(tasks) && tasks.length > 0 &&
      tasks.every(task => SETTLED.has(task.status) && task.status !== 'cancelled');
    if (!this.polls.has(turnIdOf(turn))) this.turns.delete(turnIdOf(turn));
    return !completedBeforeCancel;
  }

  /**
   * The text the team receives, with the mentions named the way it reads them.
   *
   * @param {string} text
   * @param {string[] | undefined} mentions
   */
  async withMentions(text, mentions) {
    const ids = Array.isArray(mentions) ? mentions.map((id) => String(id ?? '').trim()).filter(Boolean) : [];
    if (!ids.length) return String(text ?? '');
    let bots = [];
    try {
      bots = (await this.roster())?.bots ?? [];
    } catch {
      // A roster that cannot be read must not lose the message: the team decides who
      // speaks when nothing is mentioned.
      bots = [];
    }
    const names = [];
    for (const id of ids) {
      const bot = bots.find((entry) => entry?.botId === id);
      const name = String(bot?.name ?? '').trim();
      if (name && !names.includes(name)) names.push(name);
    }
    if (!names.length) return String(text ?? '');
    return `${names.map((name) => `@${name}`).join(' ')}\n${text}`;
  }
}

/**
 * The task receipt, out of whatever envelope the tool answered in.
 *
 * The team wraps its answer in `value`, but the bridge does not insist on it: a tool
 * that answers with the receipt itself is read just as well.
 *
 * @param {{content?: unknown, structuredContent?: unknown}} result
 */
function readReceipt(result) {
  const data = extractData(result);
  const receipt = data && typeof data === 'object' && 'value' in data ? data.value : data;
  if (!receipt || typeof receipt !== 'object') return {};
  return /** @type {Record<string, any>} */ (receipt);
}

/**
 * Pulls a JSON object out of a tool result, whatever envelope it arrived in.
 *
 * @param {unknown} result
 */
function extractData(result) {
  if (!result || typeof result !== 'object') return undefined;
  const holder = /** @type {any} */ (result);
  if (holder.structuredContent && typeof holder.structuredContent === 'object') {
    const structured = holder.structuredContent;
    if ('data' in structured && structured.data && typeof structured.data === 'object') {
      return structured.data;
    }
    if (Array.isArray(structured)) return structured;
    return structured;
  }
  const content = holder.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block.text === 'string') {
        try {
          const parsed = JSON.parse(block.text);
          if (parsed && typeof parsed === 'object') return parsed;
        } catch {
          /* not JSON; keep looking */
        }
      }
    }
  }
  if (typeof content === 'string') {
    try {
      return JSON.parse(content);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** The key a running turn is remembered under. */
function turnIdOf(turn) {
  return turn.taskId ?? turn.batchId;
}

/**
 * Builds an error that carries the protocol's error code.
 *
 * @param {string} code
 * @param {string} message
 * @param {boolean} [retryable]
 */
function codedError(code, message, retryable = false) {
  return Object.assign(new Error(message), { code, retryable });
}

/**
 * The code an error carries, if it carries one.
 *
 * @param {unknown} error
 * @returns {string | undefined}
 */
function errorCode(error) {
  const code = /** @type {any} */ (error)?.code;
  return typeof code === 'string' ? code : undefined;
}
