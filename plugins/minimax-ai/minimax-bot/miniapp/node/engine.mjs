// @ts-check
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import { t } from './i18n.mjs';
import { storageBudget } from './memory.mjs';
import { selectMemoryContext } from './memory-context.mjs';
import { UserInbox } from './user-inbox.mjs';
import { TaskDispatcher } from './task-dispatcher.mjs';
import { modelKey, newId, withEffort } from './store.mjs';
import { CONVERGE_MARK, handoverRequested, handoverSummary, hopLimit, renderHandover } from './relay-guard.mjs';
import { appendNote, notesEnabled, renderNote } from './group-note.mjs';

/** @typedef {import('./miniapp-api.js').MiniAppAgentClient} MiniAppAgentClient */
/** @typedef {import('./miniapp-api.js').MiniAppAgentRunEvent} MiniAppAgentRunEvent */
/** @typedef {import('./miniapp-api.js').MiniAppAgentRunResult} MiniAppAgentRunResult */
/** @typedef {import('./store.mjs').Store} Store */
/** @typedef {import('./memory.mjs').MemoryStore} MemoryStore */

const TOP_LEVEL_SLOTS = 3; // Leave Host capacity while all chat and task turns share these slots.
const GROUP_CONTEXT_MESSAGES = 30;
const MESSAGE_CLIP = 4000;
/**
 * Helpers run heavy work in their own Agent session while their Bot keeps chatting. They share
 * the top-level slots with chat turns, so at most this many run at once and at least one slot
 * always stays free for a reply; the rest wait in order.
 */
const MAX_RUNNING_HELPERS = 2;
/** Queued plus running helpers one Bot may have. */
const MAX_HELPERS_PER_BOT = 4;
const HELPER_REPORT_CLIP = 8000;
const HELPER_ACTIVE = new Set(['queued', 'running']);
/**
 * A turn that failed before running any tool is retried this many more times, after these waits.
 * Model capacity errors (429/529) and timeouts usually clear within a minute.
 */
export const TURN_RETRY_DELAYS_MS = Object.freeze([8000, 20000]);
/** Failure reasons a retry cannot fix; anything else (or no reason from an older Host) may be retried. */
export const NO_RETRY_REASONS = new Set(['auth', 'quota', 'context_too_long', 'blocked', 'invalid_request']);
/** The turn may already have run, so resending it could repeat a reply or an action. */
const OUTCOME_UNKNOWN = 'AGENT_OUTCOME_UNKNOWN';

/**
 * Whether a failed turn may be sent again automatically. `retryable: false` always vetoes,
 * whether it was thrown or returned, and so does an unknown outcome or a reason a retry
 * cannot fix. A thrown error is retried only when it says `retryable: true`; a returned
 * `error` result without the flag may be retried.
 *
 * @param {{ thrown: boolean, retryable?: unknown, code?: string, reason?: string }} failure
 */
export function mayRetryFailure({ thrown, retryable, code, reason }) {
  if (retryable === false) return false;
  if (code === OUTCOME_UNKNOWN) return false;
  if (reason && NO_RETRY_REASONS.has(reason)) return false;
  return thrown ? retryable === true : true;
}

/** Resolves true after `ms`, or false at once if `signal` aborts first. */
function sleepUnlessAborted(ms, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false);
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
/** Files the user can attach to one message. */
const MAX_ATTACHMENTS = 10;
/** Stored upload names: a content hash, then the sanitised original name. */
export const UPLOAD_NAME_RE = /^[0-9a-f]{12}-[^/\\\u0000]{1,160}$/;
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|avif|svg|heic)$/i;

/**
 * What the Agent reads for a user message: the text, then where each attached file is on disk,
 * so it can open them with its own file tools (read shows images to a multimodal model).
 */
export function agentTextOf(text, attachments) {
  if (!attachments?.length) return text;
  const lines = attachments.map((a) =>
    t(a.kind === 'image' ? 'attach.lineImage' : 'attach.lineFile', { name: a.name, path: a.path }),
  );
  return [text, '', t('attach.header', { n: attachments.length }), ...lines].filter((x, i) => i > 0 || x).join('\n');
}
const PASS_RE = /^\s*\[?PASS\]?\s*[.。]?\s*$/i;

export class EngineError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function clip(text, max = MESSAGE_CLIP) {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max)}${t('clip.truncated')}` : value;
}

/** Joined text parts of a streaming message. */
function textOf(parts) {
  return parts
    .filter((part) => part.type === 'text' && part.text)
    .map((part) => part.text)
    .join('\n\n');
}

function errorCode(error) {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
}

/** Result of a turn that was dropped before it reached the Agent. */
function skippedTurn() {
  return { status: 'aborted', text: '', messageId: '', skipped: true, safeToContinue: true, accepted: false };
}

/**
 * Answer failures raised before the Host saved the answer: the questionnaire is still pending,
 * so the user may submit it again. Anything else (notably AGENT_OUTCOME_UNKNOWN) may already
 * have been recorded and must not be offered for a blind resend.
 */
const ANSWER_NOT_ACCEPTED = new Set(['AGENT_UNAVAILABLE', 'INVALID_ARGUMENTS', 'BUSY', 'NOT_PERMITTED']);

function errorText(error) {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}

export class Engine {
  /**
   * @param {{
   *   store: Store,
   *   memory: MemoryStore,
   *   agent: MiniAppAgentClient | undefined,
   *   logger: import('./miniapp-api.js').MiniAppLogger,
   *   broadcast: (event: Record<string, unknown>) => void,
   * }} deps
   */
  constructor(deps) {
    this.store = deps.store;
    this.memory = deps.memory;
    this.agent = deps.agent;
    this.logger = deps.logger;
    /** Waits before each automatic retry of a failed turn (tests shorten them). */
    this.retryDelays = deps.retryDelaysMs ?? TURN_RETRY_DELAYS_MS;
    /** @type {{ at: number, value: Promise<any> } | undefined} */
    this.catalogCache = undefined;
    /** @type {Map<string, { controller: AbortController, stoppedBy?: string }>} helper id -> run */
    this.helperRuns = new Map();
    this.helperActive = 0;
    /** @type {(() => void)[]} */
    this.helperWaiters = [];
    this.broadcast = deps.broadcast;
    this.activeSlots = 0;
    /** @type {(() => void)[]} */
    this.slotWaiters = [];
    /** @type {Map<string, Promise<unknown>>} chat::bot -> tail of its serial queue */
    this.queues = new Map();
    /** @type {Set<{ chatId: string, botId: string, sourceMessageId?: string, cancelled: boolean, controller: AbortController }>} admitted, not yet settled */
    this.tickets = new Set();
    /** @type {Map<string, { controller: AbortController, chatId: string, botId: string, messageId: string }>} */
    this.running = new Map();
    /** @type {Map<string, Record<string, unknown>>} */
    this.approvals = new Map();
    /** @type {Map<string, { cancelled: boolean }>} */
    this.groupLoops = new Map();
    /** Coalesces duplicate HTTP submissions until their durable message is available. */
    this.userMessageRequests = new Map();
    this.inbox = new UserInbox(this, EngineError);
    this.tasks = new TaskDispatcher(this, EngineError);
    this.retryRequests = new Set();
    this.answerRequests = new Set();
    this.disposed = false;
    /** @type {ReturnType<typeof setInterval> | undefined} */
    this.scheduleTimer = undefined;
  }

  // ------------------------------------------------------------------ slots
  async acquireSlot(signal) {
    if (signal?.aborted) return false;
    if (this.activeSlots < TOP_LEVEL_SLOTS) { this.activeSlots += 1; return true; }
    return new Promise((resolve) => {
      const wake = () => { signal?.removeEventListener('abort', abort); resolve(true); };
      const abort = () => {
        this.slotWaiters = this.slotWaiters.filter((waiter) => waiter !== wake);
        resolve(false);
      };
      this.slotWaiters.push(wake);
      signal?.addEventListener('abort', abort, { once: true });
    });
  }

  releaseSlot() {
    const next = this.slotWaiters.shift();
    if (next) next(); // Transfer ownership without temporarily exposing a free slot.
    else this.activeSlots -= 1;
  }

  serial(key, task) {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    const tail = next.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(key, tail);
    void tail.then(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key);
      this.tasks.pump();
    });
    return next;
  }

  isBusy(chatId) {
    if (this.inbox.busy(chatId)) return true;
    for (const turn of this.running.values()) if (turn.chatId === chatId) return true;
    for (const ticket of this.tickets) if (ticket.chatId === chatId && !ticket.cancelled) return true;
    const loop = this.groupLoops.get(chatId);
    return Boolean(loop && !loop.cancelled);
  }

  busyChats() {
    const set = new Set([...this.inbox.batches].filter((batch) => !batch.cancelled).map((batch) => batch.chatId));
    for (const turn of this.running.values()) set.add(turn.chatId);
    for (const ticket of this.tickets) if (!ticket.cancelled) set.add(ticket.chatId);
    for (const [chatId, loop] of this.groupLoops) if (!loop.cancelled) set.add(chatId);
    return [...set];
  }

  emitBusy(chatId) {
    this.broadcast({ type: 'chat.busy', chatId, busy: this.isBusy(chatId), turns: this.turnsList() });
  }

  // ------------------------------------------------------------------ prompt
  roster() {
    const { bots, groups } = this.store.state;
    const botLines = bots.map((bot) =>
      t('brief.botLine', { name: bot.name, id: bot.id, main: bot.isMain ? t('brief.mainTag') : '', role: bot.role || t('brief.noRole') }),
    );
    const groupLines = groups.map((group) => {
      const admin = this.store.getBot(group.adminId)?.name ?? t('brief.none');
      const members = group.memberIds
        .map((id) => this.store.getBot(id)?.name)
        .filter(Boolean)
        .join(t('list.sep'));
      return t('brief.groupLine', { name: group.name, id: group.id, admin, members });
    });
    return { botLines, groupLines };
  }

  /**
   * The hop limit of a group: how many Bots may speak in one relay chain. 0 = no limit, which
   * is the baseline behaviour (the chain runs as long as the Bots hand over to each other).
   *
   * The limit belongs to the group and only the operator sets it (the panel writes
   * `group.maxHops`); the model cannot change it, so a relay chain cannot be extended by the
   * Bot that is running it.
   *
   * @param {any} group
   * @returns {number}
   */
  maxHops(group) {
    return hopLimit(group);
  }

  /**
   * Whether the conclusion of the previous hop travels with the next hop's prompt.
   * @param {any} group
   * @returns {boolean}
   */
  handoverEnabled(group) {
    return handoverRequested(group);
  }

  /**
   * Whether the group really has guardrails on. The prompt-level rule (one owner per stage)
   * follows this one, so a group without guardrails keeps the baseline prompt byte for byte.
   * @param {any} group
   * @returns {boolean}
   */
  relayGuardActive(group) {
    return this.maxHops(group) > 0 || this.handoverEnabled(group);
  }

  /**
   * The conclusion of the previous hop, handed over to the next one.
   *
   * Free by construction: the summary is text that rides along with the next turn — no model
   * turn, no tool call, no memory write. The note the group already produced wins; without a
   * note the tail of the previous reply is used.
   *
   * @param {any} group
   * @param {{ botId: string, name: string, text: string, ts: number } | undefined} last
   * @returns {{ from: string, text: string } | undefined}
   */
  handoverFor(group, last) {
    if (!this.handoverEnabled(group)) return undefined;
    if (!last?.text) return undefined;
    // This build keeps no group notes, so the hand-over carries the tail of the reply.
    const text = handoverSummary({ note: '', reply: last.text });
    if (!text) return undefined;
    return { from: last.name, text };
  }


  /**
   * The chain reached its hop limit: the round converges instead of relaying on.
   *
   * Two things happen, in this order. The group is told why the chain stopped — a system notice
   * plus an event, so the panel can show it — and then the Bot that just spoke is asked to wrap
   * up. The hop that was blocked does not run, but the wrap-up is a model turn of its own: a
   * round that reaches the limit therefore runs `limit + 1` model turns, the last one being the
   * wrap-up. When it fails the notice stands on its own and the round ends; a group must never
   * be left hanging because a model call failed.
   *
   * @param {any} group
   * @param {string} chatId
   * @param {{ reason: string, max: number }} info
   * @param {{ botId: string, name: string, text: string, ts: number } | undefined} last
   * @param {{ sourceMessageId?: string, sourceMessageIds?: string[], taskId?: string, signal?: AbortSignal }} [options]
   * @returns {Promise<{ ok: boolean, reason: string, text: string }>}
   */
  async convergeGroup(group, chatId, info, last, options = {}) {
    const notice = await this.store.appendMessage(chatId, {
      role: 'system',
      key: 'notice.hopLimit',
      params: { max: info.max },
      text: t('notice.hopLimit', { max: info.max }),
    });
    this.broadcast({ type: 'message.upsert', chatId, message: notice });
    this.broadcastSummary(chatId);
    this.broadcast({
      type: 'group.hopLimit', chatId, groupId: group.id, reason: info.reason, max: info.max, hops: info.max,
    });
    const bot = last?.botId ? this.store.getBot(last.botId) : undefined;
    if (!bot) return { ok: false, reason: 'no_speaker', text: '' };
    const result = await this.runBotTurn({
      bot,
      chatId,
      text: `${CONVERGE_MARK}\n${t('relay.converge', { max: info.max })}`,
      kind: 'group',
      sourceMessageId: options.sourceMessageId,
      sourceMessageIds: options.sourceMessageIds,
      signal: options.signal,
      // The wrap-up belongs to the same round, so it belongs to the same task. Without it a
      // group relay that came in through the task dispatcher would end up outside the task.
      taskId: options.taskId,
    });
    if (result.status !== 'done') {
      this.logger.warn('minimax_bot.relay_converge_failed', { code: errorCode(result) || 'unknown' });
      return { ok: false, reason: 'turn_failed', text: '' };
    }
    return { ok: true, reason: 'converged', text: result.text ?? '' };
  }

  /**
   * Write what the round said into the group's note.
   *
   * The note lives in the group record, so it survives a reset of the group's chat, and every
   * Bot of the group gets it in its standing brief. Nothing here spends a turn: the text is the
   * closing part of the replies the group already produced. A group that keeps no note is left
   * alone, and so is a round that said nothing.
   *
   * @param {any} group
   * @param {{ speaker: string, text: string }[]} round
   */
  async recordGroupNote(group, round) {
    if (!round.length) return;
    const current = this.store.getGroup(group.id);
    if (!current || !notesEnabled(current)) return;
    const entries = appendNote(current.noteEntries, round);
    if (!entries.length) return;
    current.noteEntries = entries;
    await this.store.save();
    this.broadcast({ type: 'state.changed' });
  }

  /** The Bot's standing context, written in the user's language so replies default to it. */
  buildStandingBrief(bot, chatId) {
    const { botLines, groupLines } = this.roster();
    const group = chatId.startsWith('group:') ? this.store.getGroup(chatId.slice(6)) : undefined;
    const isAdmin = group?.adminId === bot.id;
    // F7 · the group has the relay guardrails on: the prompt gets the one-owner rule. With the
    // guardrails off this adds nothing, so the prompt stays byte-identical.
    const relayGuard = group ? this.relayGuardActive(group) : false;
    // The group's note: what its Bots said at the end of the earlier rounds. It is empty unless
    // the group keeps one, so the brief of a group without notes stays byte-identical.
    const note = group ? renderNote(group) : '';
    const lines = [
      '<minimax-bot-context>',
      t('brief.intro', { name: bot.name, id: bot.id }),
      bot.role ? t('brief.role', { role: bot.role }) : '',
      bot.isMain ? t('brief.mainPower') : '',
      '',
      t('brief.hInstructions'),
      bot.instructions?.trim() || t('brief.noInstructions'),
      '',
      t('brief.hChat'),
      group
        ? [
            t('brief.inGroup', { name: group.name, notice: group.notice || t('brief.none') }),
            isAdmin ? t('brief.groupAdmin') : t('brief.groupMember'),
            t('brief.groupPass'),
            t('brief.groupNoPost'),
            // The one-owner rule joins the list only when it is in force. Adding an empty
            // string instead would still append a separator, and the English separator is a
            // space — the brief would differ from the baseline by one trailing space.
            ...(relayGuard ? [t('brief.groupOneOwner')] : []),
          ].join(t('brief.sentenceJoin'))
        : t('brief.private'),
      // The note joins the brief only when the group has one. It is a block of its own, so it
      // does not disturb the sentence the group line is made of.
      ...(note ? ['', note] : []),
      '',
      t('brief.hTeam'),
      ...botLines,
      groupLines.length ? t('brief.groups') : '',
      ...groupLines,
      '',
      t('brief.hTools'),
      t('brief.toolsWhere'),
      t('brief.callerId', { id: bot.id }),
      t('brief.tool.list'),
      t('brief.tool.message'),
      t('brief.tool.tasks'),
      group ? '' : t('brief.tool.postGroup'),
      bot.autoHelper === false ? t('brief.tool.helperOff') : t('brief.tool.helper'),
      t('brief.tool.memory'),
      bot.isMain || isAdmin ? t('brief.tool.updateGroup') : '',
      bot.isMain ? t('brief.tool.manage') : '',
      t('brief.tool.schedule'),
      t('brief.scheduleRule'),
      '',
      t('brief.hMemory'),
      t('brief.memoryRules'),
      '',
      t('brief.hReply'),
      t('brief.reply'),
      '</minimax-bot-context>',
    ];
    return lines.filter((line, index, all) => !(line === '' && all[index - 1] === '')).join('\n');
  }

  async buildMemoryBrief(bot, query = '') {
    const own = await this.memory.list(bot.id);
    const team = await this.memory.list('team');
    const selected = selectMemoryContext([
      ...own.map((entry) => ({ ...entry, scope: bot.id })),
      ...team.map((entry) => ({ ...entry, scope: 'team' })),
    ], { query });
    return [
      '<minimax-bot-memory>',
      t('brief.memorySelection', { ...selected, count: selected.entries.length }),
      t('brief.ownMemory'), t('brief.memoryBudget', storageBudget(own)),
      t('brief.teamMemory'), t('brief.memoryBudget', storageBudget(team)),
      selected.text || t('brief.empty'),
      '</minimax-bot-memory>',
    ].join('\n');
  }

  async buildBrief(bot, chatId, query = '') {
    return `${this.buildStandingBrief(bot, chatId)}\n\n${await this.buildMemoryBrief(bot, query)}`;
  }

  // ------------------------------------------------------------------ core turn
  /**
   * Run one turn for a Bot in a chat and stream it into a new Bot message.
   * @param {{
   *   bot: any, chatId: string, text: string, kind: string,
   *   sourceMessageId?: string, sourceMessageIds?: string[], taskId?: string, signal?: AbortSignal,
   *   answer?: { sessionId: string, requestId: string, answers: any[] },
   *   handover?: { from: string, text: string },
   * }} input
   * @returns {Promise<{ status: string, text: string, messageId: string, sessionId?: string }>}
   */
  runBotTurn(input) {
    const key = `${input.chatId}::${input.bot.id}`;
    // A ticket exists from admission until the turn settles, so a turn still waiting for its
    // queue or a slot counts as busy and can be cancelled before it ever reaches the Agent.
    const ticket = { chatId: input.chatId, botId: input.bot.id, sourceMessageId: input.sourceMessageId, cancelled: false, controller: new AbortController() };
    const abort = () => { ticket.cancelled = true; ticket.controller.abort(); };
    input.signal?.addEventListener('abort', abort, { once: true });
    if (input.signal?.aborted) abort();
    this.tickets.add(ticket);
    this.emitBusy(input.chatId);
    const settle = () => {
      input.signal?.removeEventListener('abort', abort);
      this.tickets.delete(ticket);
      this.emitBusy(input.chatId);
      queueMicrotask(() => this.tasks.pump());
    };
    ticket.done = this.serial(key, async () => {
      try {
        if (this.isStale(ticket)) return skippedTurn();
        const acquired = await this.acquireSlot(ticket.controller.signal);
        if (!acquired) return skippedTurn();
        try {
          if (this.isStale(ticket)) return skippedTurn();
          return await this.executeTurn(input, key, ticket);
        } finally {
          this.releaseSlot();
        }
      } finally {
        try {
          if (ticket.cancelled && ticket.sourceMessageId) {
            const messages = await this.store.getMessages(ticket.chatId);
            if (!messages.some((message) => message.sourceMessageId === ticket.sourceMessageId)) {
              await this.store.updateMessage(ticket.chatId, ticket.sourceMessageId, { dispatchState: 'cancelled' });
            }
          }
        } finally { settle(); }
      }
    });
    return ticket.done;
  }

  /** The turn was cancelled, or its Bot / group was deleted while it waited. */
  isStale(ticket) {
    if (ticket.cancelled || this.disposed) return true;
    if (!this.store.getBot(ticket.botId)) return true;
    return ticket.chatId.startsWith('group:') && !this.store.getGroup(ticket.chatId.slice(6));
  }

  async executeTurn(input, key, ticket) {
    const { bot, chatId } = input;
    if (!this.agent) throw new EngineError('agent_unavailable', t('err.noAgentSupport'));
    const message = await this.store.appendMessage(chatId, {
      role: 'bot',
      botId: bot.id,
      text: '',
      status: 'streaming',
      parts: [],
      kind: input.kind,
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.sourceMessageId ? { sourceMessageId: input.sourceMessageId } : {}),
      ...(input.sourceMessageIds ? { sourceMessageIds: input.sourceMessageIds } : {}),
      startedAt: Date.now(),
    });
    this.broadcast({ type: 'message.upsert', chatId, message });

    // Admission owns cancellation, including the interval while its placeholder is written.
    // Reusing that controller prevents a stopped ticket from acquiring a fresh live signal.
    const { controller } = ticket;
    if (this.isStale(ticket)) controller.abort();
    /** @type {any} */
    const entry = { controller, chatId, botId: bot.id, messageId: message.id, message, approvals: new Set(), startedAt: Date.now() };
    entry.flush = (force = false) => flush(force);
    this.running.set(key, entry);
    this.emitBusy(chatId);

    const startedAt = Date.now();
    let lastFlush = 0;
    let rootSessionId = this.store.getSession(chatId, bot.id)?.sessionId;
    let toolStarted = false;
    /** Whether any attempt started a turn, i.e. the session already holds this input. */
    let reachedHost = false;
    let invoked = false;
    let preparedInput = input;
    let acceptedGroupCursor;
    /** @type {{ type: 'text', text: string, live?: boolean } | undefined} */
    let liveText;
    const flush = (force = false) => {
      const now = Date.now();
      if (!force && now - lastFlush < 120) return;
      lastFlush = now;
      message.text = textOf(message.parts);
      this.broadcast({ type: 'message.upsert', chatId, message });
    };
    const ensureLiveText = () => {
      if (!liveText || message.parts.at(-1) !== liveText) {
        liveText = { type: 'text', text: '', live: true };
        message.parts.push(liveText);
      }
      return liveText;
    };

    /** @param {MiniAppAgentRunEvent} event */
    const onEvent = (event) => {
      switch (event.type) {
        case 'turn.started':
          // The Host has the message now: a later retry need not (and must not) send it again.
          reachedHost = true;
          acceptedGroupCursor = preparedInput.groupCursor;
          rootSessionId = event.sessionId;
          message.sessionId = event.sessionId;
          const task = input.taskId && this.tasks.tasks.find((item) => item.id === input.taskId);
          if (task) {
            task.sessionId = event.sessionId;
            void this.tasks.save().catch((error) => this.logger.warn('minimax_bot.task_save_failed', { taskId: task.id, code: error?.code ?? 'unknown' }));
          }
          void this.store.setSession(chatId, bot.id, { sessionId: event.sessionId });
          flush(true);
          break;
        case 'text.delta':
          ensureLiveText().text += event.text;
          flush();
          break;
        case 'message.committed': {
          // The Host commits a whole assistant message while `text.delta` streams that same
          // message in chunks. A tool call inside the message already closed the live part, so
          // committing blindly would append a second copy of words the deltas delivered.
          // Reuse the trailing text part when this commit is that part's full text; only start
          // a new part when the commit carries text no delta produced.
          const tail = [...message.parts].reverse().find((part) => part.type === 'text');
          const tailText = tail?.text ?? '';
          const sameMessage = Boolean(tail) && (event.text.startsWith(tailText) || tailText.startsWith(event.text));
          const part = sameMessage ? /** @type {any} */ (tail) : { type: 'text', text: event.text };
          if (!sameMessage) message.parts.push(part);
          part.text = event.text;
          delete part.live;
          if (liveText && liveText !== part) delete liveText.live;
          liveText = undefined;
          flush(true);
          break;
        }
        case 'tool.started':
          // Once a tool ran, the turn may have done something (sent, created, written): a failure
          // after that is never retried automatically.
          toolStarted = true;
          if (liveText) delete liveText.live;
          liveText = undefined;
          message.parts.push({ type: 'tool', name: event.name, state: 'running' });
          flush(true);
          break;
        case 'tool.finished': {
          // Once this turn has authoritative MCP memory outcomes, name-only Host events
          // cannot identify the remaining concurrent calls (including Host-only failures).
          if (event.name === 'mcp__minimax-bot__remember' && entry.memoryManaged) break;
          const tool = [...message.parts]
            .reverse()
            .find((part) => part.type === 'tool' && part.name === event.name && part.state === 'running');
          if (tool) tool.state = event.ok ? 'ok' : 'failed';
          flush(true);
          break;
        }
        case 'permission.requested': {
          const approval = {
            requestId: event.requestId,
            sessionId: event.sessionId,
            chatId,
            botId: bot.id,
            toolName: event.toolName,
            toolInput: clip(event.toolInput ?? '', 1500),
            reason: event.reason,
            ts: Date.now(),
          };
          this.approvals.set(event.requestId, approval);
          entry.approvals.add(approval);
          this.broadcast({ type: 'approval.added', approval });
          this.broadcastSummary(chatId);
          break;
        }
        default:
          break;
      }
    };

    let result;
    let failure = '';
    let failureCode = '';
    /** @type {unknown} */
    let failureRetryable;
    let failureReason = '';
    let attempt = 0;
    try {
      for (;;) {
        result = undefined;
        failure = '';
        failureCode = '';
        failureRetryable = undefined;
        failureReason = '';
        if (controller.signal.aborted || this.isStale(ticket)) {
          controller.abort();
          result = skippedTurn();
          break;
        }
        // A retry must not resend the user's words once a failed turn put them in the session; it
        // asks the Agent to answer them now. If no turn ever started, the words were never
        // delivered, so the retry sends them as they were.
        try {
          if (attempt === 0) preparedInput = await this.prepareGroupInput(input);
          const attemptInput = attempt === 0 || !reachedHost ? preparedInput : { ...preparedInput, text: t('retry.continue') };
          invoked = true;
          result = await this.invoke(attemptInput, rootSessionId, controller.signal, onEvent) ?? skippedTurn();
        } catch (error) {
          if (errorCode(error) === 'SESSION_NOT_FOUND' && !input.answer && attempt === 0) {
            // The Agent session was deleted; start a fresh one and resend the Bot's context.
            await this.store.clearSession(chatId, bot.id);
            try {
              preparedInput = await this.prepareGroupInput(input);
              result = await this.invoke(preparedInput, undefined, controller.signal, onEvent) ?? skippedTurn();
            } catch (retryError) {
              failure = describeAgentError(retryError);
              failureCode = errorCode(retryError);
              failureRetryable = /** @type {any} */ (retryError)?.retryable;
              failureReason = String(/** @type {any} */ (retryError)?.reason ?? '');
            }
          } else {
            failure = describeAgentError(error);
            failureCode = errorCode(error);
            failureRetryable = /** @type {any} */ (error)?.retryable;
            failureReason = String(/** @type {any} */ (error)?.reason ?? '');
          }
        }
        const thrown = Boolean(failure);
        const failed = thrown || result?.status === 'error';
        const canRetry =
          failed &&
          mayRetryFailure(thrown
            ? { thrown, retryable: failureRetryable, code: failureCode, reason: failureReason }
            : { thrown, retryable: result?.error?.retryable, code: result?.error?.code, reason: result?.error?.reason }) &&
          !input.answer &&
          !toolStarted &&
          attempt < this.retryDelays.length &&
          !controller.signal.aborted &&
          !this.disposed;
        if (!canRetry) break;
        const delay = this.retryDelays[attempt];
        attempt += 1;
        // Words the failed attempt streamed are not the reply; the retry writes its own.
        message.parts = message.parts.filter((part) => part.type !== 'text');
        liveText = undefined;
        message.live = { key: 'live.retrying', params: { s: Math.round(delay / 1000), n: attempt + 1, max: this.retryDelays.length + 1 } };
        flush(true);
        const waited = await sleepUnlessAborted(delay, controller.signal);
        message.live = undefined;
        if (!waited) {
          // Stopped while waiting to retry: end as the stop it was, not as the failure before it.
          result = { status: 'aborted', sessionId: result?.sessionId ?? rootSessionId };
          failure = '';
          failureCode = '';
          break;
        }
      }
    } finally {
      this.running.delete(key);
      this.clearRunApprovals(entry.approvals, chatId);
    }

    for (const part of message.parts) {
      if (part.type === 'text') delete part.live;
      if (part.type === 'tool' && part.state === 'running') part.state = 'unknown';
    }
    message.parts = message.parts.filter((part) => part.type !== 'text' || part.text.trim());
    const streamed = textOf(message.parts);
    const finalText = (result?.text ?? streamed).trim();
    if (finalText && !message.parts.some((part) => part.type === 'text')) {
      message.parts.push({ type: 'text', text: finalText });
    }
    const status = failure ? 'error' : result?.status === 'finished' ? 'done' : result?.status ?? 'error';
    message.text = finalText;
    message.status = status;
    message.live = undefined;
    message.durationMs = Date.now() - startedAt;
    if (failure) {
      message.error = failure;
      // The page localises known codes; `error` keeps the text for anything else.
      if (failureCode) message.errorCode = failureCode;
    }
    else if (result?.error) {
      // A Host that classifies the failure says why; an older one sends only a generic sentence,
      // so say what to do instead of repeating it.
      const reason = result.error.reason;
      const known = reason ? t(`agentError.reason.${reason}`) : '';
      message.error =
        known && known !== `agentError.reason.${reason}`
          ? known
          : /^The Agent turn failed\.?$/.test(result.error.message ?? '')
            ? t('agentError.turnFailed')
            : result.error.message;
      if (reason) message.errorReason = reason;
    }
    // Retried automatically before giving up: say so, so the user knows it was not ignored.
    if (status === 'error' && attempt > 0) message.retried = attempt;
    // The user can try again by hand unless the turn already did something or was an answer.
    if (status === 'error' && !input.taskId && !input.answer && !toolStarted && failureCode !== 'AGENT_OUTCOME_UNKNOWN') {
      message.retryable = true;
      // Never delivered: the retry button must send the words themselves, not "answer them now".
      if (!reachedHost) message.retryInput = clip(input.text, 60000);
    }
    if (result?.sessionId) message.sessionId = result.sessionId;
    if (result?.pendingQuestion) {
      message.question = {
        requestId: result.pendingQuestion.requestId,
        mode: result.pendingQuestion.mode,
        request: result.pendingQuestion.request,
      };
    }
    await this.store.updateMessage(chatId, message.id, {});
    if (result?.sessionId) {
      await this.store.setSession(chatId, bot.id, { sessionId: result.sessionId });
    }
    if (acceptedGroupCursor !== undefined) {
      const previous = this.store.getSession(chatId, bot.id)?.lastSeenSeq ?? 0;
      await this.store.setSession(chatId, bot.id, { lastSeenSeq: Math.max(previous, acceptedGroupCursor) });
    }
    this.broadcast({ type: 'message.upsert', chatId, message });
    this.emitBusy(chatId);
    this.broadcastSummary(chatId);

    const tools = message.parts.filter((part) => part.type === 'tool').length;
    await this.store.recordUsage({
      ts: Date.now(),
      botId: bot.id,
      botName: bot.name,
      chatId,
      kind: input.kind,
      status,
      durationMs: message.durationMs,
      chars: finalText.length,
      tools,
    });
    this.broadcast({ type: 'usage.changed' });
    return {
      status,
      text: finalText,
      messageId: message.id,
      sessionId: result?.sessionId,
      errorCode: failureCode || undefined,
      error: message.error,
      toolCount: tools,
      accepted: reachedHost || Boolean(result && !result.skipped),
      // A returned terminal result is known; exceptions after admission may have lost observation.
      safeToContinue: Boolean(result && !result.pendingQuestion) || (!reachedHost && (!invoked || [
        'BUSY', 'NOT_PERMITTED', 'INVALID_ARGUMENTS', 'AGENT_UNAVAILABLE', 'SESSION_NOT_FOUND',
      ].includes(failureCode))),
      skipped: Boolean(result?.skipped),
      // The turn ended waiting for the user: its text is not the Bot's final answer.
      pendingQuestion: Boolean(result?.pendingQuestion),
      waitingForTasks: Boolean(input.taskId && this.tasks.pendingDependencies(this.tasks.task(input.taskId)).length),
    };
  }

  /**
   * The SDK has no authenticated MCP invocation/session context. Until it does, capture a
   * unique live turn once at tool admission and refuse ambiguous callers instead of guessing.
   * caller_bot_id remains a behavioral convention, not an authentication boundary.
   */
  bindCallerTurn(botId) {
    if (!botId) return undefined;
    const turns = [...this.running.values()].filter((turn) => turn.botId === botId);
    if (turns.length > 1) throw new EngineError('busy', t('err.callerAmbiguous'));
    return turns.length === 1 && this.isActiveTurn(turns[0]) ? turns[0] : undefined;
  }

  isActiveTurn(turn) {
    return Boolean(turn && !this.disposed && !turn.controller?.signal.aborted &&
      this.running.get(`${turn.chatId}::${turn.botId}`) === turn);
  }

  requireCallerTurn(caller, invocation) {
    if (!caller) return undefined;
    const turn = invocation ? invocation.turn : this.bindCallerTurn(caller.id);
    if (!turn || turn.botId !== caller.id || !this.isActiveTurn(turn)) {
      throw new EngineError('busy', t('err.callerTurnMissing'));
    }
    return turn;
  }

  /** Shows a live activity line ("正在创建 写手") on the caller's current message. */
  setLive(turn, label) {
    if (!this.isActiveTurn(turn)) return;
    turn.message.live = label || undefined;
    turn.flush(true);
  }

  /** Appends a team event ("已创建 写手") to the caller's current message. */
  attachEvent(turn, event) {
    if (!this.isActiveTurn(turn)) return;
    turn.message.parts.push({ type: 'event', ...event });
    turn.flush(true);
  }

  /** Without host call IDs, attach diagnostics only when attribution is unambiguous. */
  captureToolIssue(botId, name, issue, invocation) {
    if (!botId) return;
    const turns = [...this.running.values()].filter((turn) => turn.botId === botId);
    const turn = invocation ? invocation.turn : turns.length === 1 ? turns[0] : undefined;
    if (!turn || (invocation && !this.isActiveTurn(turn))) return;
    const part = invocation && Object.hasOwn(invocation, 'toolPart')
      ? invocation.toolPart : this.bindToolPart(turn, name);
    if (!part || !turn.message.parts.includes(part)) return;
    part.issue = issue;
    turn.flush(true);
  }

  bindToolPart(turn, name) {
    const candidates = turn?.message.parts.filter((part) => part.type === 'tool' && part.state === 'running' && part.name === `mcp__minimax-bot__${name}`) ?? [];
    return candidates.length === 1 ? candidates[0] : undefined;
  }

  finishMemoryCall(invocation, ok) {
    const { turn, toolPart } = invocation;
    if (!this.isActiveTurn(turn)) return;
    // An unbound part stays unknown rather than borrowing another call's Host outcome.
    turn.memoryManaged = true;
    if (toolPart && turn.message.parts.includes(toolPart)) toolPart.state = ok ? 'ok' : 'failed';
    turn.flush(true);
  }

  captureMemoryReceipt(invocation, receipt) {
    const { turn, toolPart } = invocation;
    if (!this.isActiveTurn(turn) || !toolPart || !turn.message.parts.includes(toolPart)) return;
    toolPart.memoryReceipt = receipt;
    turn.flush(true);
  }

  /** A child-session approval belongs to the run that delivered it, not its session ID. */
  clearRunApprovals(approvals, chatId) {
    let changed = false;
    for (const approval of approvals) {
      if (this.approvals.get(approval.requestId) !== approval) continue;
      this.approvals.delete(approval.requestId);
      this.broadcast({ type: 'approval.removed', requestId: approval.requestId });
      changed = true;
    }
    approvals.clear();
    if (changed) this.broadcastSummary(chatId);
  }

  broadcastSummary(chatId) {
    const summary = this.store.summary(chatId);
    summary.pending = summary.pending || [...this.approvals.values()].some((a) => a.chatId === chatId);
    this.broadcast({ type: 'chat.summary', chatId, summary });
  }

  turnsList() {
    return [...this.running.values()].map((turn) => ({ chatId: turn.chatId, botId: turn.botId }));
  }

  /** Undefined means cancellation was observed before calling the Host. @returns {Promise<MiniAppAgentRunResult | undefined>} */
  async invoke(input, sessionId, signal, onEvent) {
    if (signal.aborted || this.disposed) return undefined;
    const agent = /** @type {MiniAppAgentClient} */ (this.agent);
    if (input.answer) {
      return agent.answer(input.answer, { signal, onEvent });
    }
    const brief = this.buildStandingBrief(input.bot, input.chatId);
    const memoryBrief = await this.buildMemoryBrief(input.bot, input.memoryQuery ?? input.text);
    if (signal.aborted || this.disposed) return undefined;
    const stamp = createHash('sha1').update(brief).digest('hex');
    const known = sessionId ? this.store.getSession(input.chatId, input.bot.id) : undefined;
    const memoryStamp = createHash('sha1').update(memoryBrief).digest('hex');
    const text = [
      !sessionId || known?.stamp !== stamp ? brief : '',
      !sessionId || known?.memoryStamp !== memoryStamp ? memoryBrief : '',
      input.text,
    ].filter(Boolean).join('\n\n');
    const model = await this.turnModel(input.bot, known);
    if (signal.aborted || this.disposed) return undefined;
    let result;
    try {
      result = await agent.run({ text, sessionId, ...(model ? { model } : {}) }, { signal, onEvent });
    } catch (error) {
      // The Host rejects a model it no longer offers before the turn starts; say which setting to fix.
      if (model && errorCode(error) === 'INVALID_ARGUMENTS') {
        throw Object.assign(new Error(errorText(error)), { code: 'MODEL_UNAVAILABLE' });
      }
      throw error;
    }
    await this.store.setSession(input.chatId, input.bot.id, {
      sessionId: result.sessionId,
      stamp,
      memoryStamp,
      // The model this session was last switched to by the Bot's setting; empty when it never was.
      model: model && (input.bot.model || input.bot.effort) ? modelKey(model) : undefined,
    });
    return result;
  }

  /** True when the Host lets a run pick its model (`agent.models()` / `run({ model })`). */
  supportsModels() {
    return typeof this.agent?.models === 'function';
  }

  /**
   * The Host's model catalog and default, cached briefly so a busy group round does not ask for
   * it on every turn. `undefined` on a Host without per-run models.
   */
  async modelCatalog({ fresh = false } = {}) {
    if (!this.supportsModels()) return undefined;
    const now = Date.now();
    if (fresh || !this.catalogCache || now - this.catalogCache.at > 60_000) {
      const value = /** @type {any} */ (this.agent).models();
      this.catalogCache = { at: now, value };
      // A failed lookup must not be served from the cache for the next minute.
      value.catch(() => {
        if (this.catalogCache?.value === value) this.catalogCache = undefined;
      });
    }
    return this.catalogCache.value;
  }

  /**
   * What `model` a turn passes: the Bot's own model when it has one; the default once, to switch a
   * session back after the Bot's model was cleared; otherwise nothing (the session keeps its model).
   */
  async turnModel(bot, known) {
    if (!this.supportsModels()) return undefined;
    if (bot.model) return bot.model;
    if (bot.effort) {
      // The default model at this Bot's effort; if the default no longer offers it, plain default.
      const catalog = await this.modelCatalog();
      const def = catalog?.default;
      if (def) {
        const entry = (catalog.models ?? []).find((m) => m.providerId === def.providerId && m.modelId === def.modelId);
        return withEffort(entry, bot.effort) ?? def;
      }
    }
    if (known?.model) return (await this.modelCatalog())?.default;
    return undefined;
  }

  // ------------------------------------------------------------------ user entry points
  /**
   * Checks the uploads a message names and returns what the message stores: each must be a file
   * this Mini App received through /api/uploads.
   * @param {unknown} ids
   */
  async resolveAttachments(ids) {
    if (ids === undefined || ids === null) return [];
    if (!Array.isArray(ids)) throw new EngineError('invalid', t('err.badAttachment'));
    if (ids.length > MAX_ATTACHMENTS) throw new EngineError('invalid', t('err.tooManyAttachments', { n: MAX_ATTACHMENTS }));
    const out = [];
    for (const raw of ids) {
      const id = String(raw ?? '');
      if (!UPLOAD_NAME_RE.test(id) || id.includes('..')) throw new EngineError('invalid', t('err.badAttachment'));
      const path = join(this.store.dir, 'uploads', id);
      const info = await stat(path).catch(() => undefined);
      if (!info?.isFile()) throw new EngineError('invalid', t('err.attachmentGone'));
      const name = id.slice(13);
      out.push({ id, name, size: info.size, kind: IMAGE_EXT_RE.test(name) ? 'image' : 'file', path });
    }
    return out;
  }

  async sendUserMessage(chatId, text, attachmentIds, clientMessageId) {
    if (clientMessageId === undefined || clientMessageId === null) {
      return this.acceptUserMessage(chatId, text, attachmentIds);
    }
    if (typeof clientMessageId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(clientMessageId)) {
      throw new EngineError('invalid', t('err.messageIdInvalid'));
    }
    const fingerprint = this.userMessageFingerprint(text, attachmentIds);
    const key = `${chatId}\u0000${clientMessageId}`;
    const pending = this.userMessageRequests.get(key);
    if (pending) {
      if (pending.fingerprint !== fingerprint) throw new EngineError('invalid', t('err.messageIdConflict'));
      return pending.promise;
    }
    const promise = this.acceptUserMessage(chatId, text, attachmentIds, { clientMessageId, fingerprint });
    const request = { fingerprint, promise };
    this.userMessageRequests.set(key, request);
    try {
      return await promise;
    } finally {
      if (this.userMessageRequests.get(key) === request) this.userMessageRequests.delete(key);
    }
  }

  userMessageFingerprint(text, attachmentIds) {
    if (attachmentIds !== undefined && attachmentIds !== null && !Array.isArray(attachmentIds)) {
      throw new EngineError('invalid', t('err.badAttachment'));
    }
    return createHash('sha256').update(JSON.stringify({
      text: String(text ?? '').trim(), attachments: (attachmentIds ?? []).map((id) => String(id ?? '')),
    })).digest('hex');
  }

  async acceptUserMessage(chatId, text, attachmentIds, request) {
    const bot = chatId.startsWith('bot:') ? this.store.getBot(chatId.slice(4)) : undefined;
    const group = chatId.startsWith('group:') ? this.store.getGroup(chatId.slice(6)) : undefined;
    if (!bot && !group) throw new EngineError('not_found', t('err.chatMissing'));
    if (request) {
      const messages = await this.store.getMessages(chatId);
      const existing = messages.find((message) =>
        message.role === 'user' && message.clientMessageId === request.clientMessageId);
      if (existing) {
        const fingerprint = existing.clientMessageHash ?? this.userMessageFingerprint(existing.text, (existing.attachments ?? []).map((a) => a.id));
        if (fingerprint !== request.fingerprint) throw new EngineError('invalid', t('err.messageIdConflict'));
        const admitted = this.inbox.has(existing.id) || [...this.tickets].some((ticket) => ticket.chatId === chatId && ticket.sourceMessageId === existing.id);
        const replies = messages.filter((message) => message.sourceMessageId === existing.id || message.sourceMessageIds?.includes(existing.id));
        if (!admitted && (existing.dispatchState === 'uncertain' || replies.some((message) =>
          message.status === 'interrupted' || message.status === 'streaming' || message.errorCode === 'AGENT_OUTCOME_UNKNOWN'))) {
          await this.store.updateMessage(chatId, existing.id, { dispatchState: 'uncertain' });
          this.broadcast({ type: 'message.upsert', chatId, message: existing });
          throw new EngineError('delivery_uncertain', t('err.messageDeliveryUncertain'));
        }
        // Only the new protocol's explicitly pending messages are recoverable. A durable
        // assistant placeholder is written before contacting the Host, so its absence plus
        // no live ticket proves this request was never dispatched. Legacy records do not.
        if (!admitted && !replies.length && existing.dispatchState === 'pending') {
          this.dispatchUserMessage(chatId, existing, bot, group);
        }
        return existing;
      }
    }
    const clean = String(text ?? '').trim();
    const attachments = await this.resolveAttachments(attachmentIds);
    if (!clean && !attachments.length) throw new EngineError('invalid', t('err.emptyMessage'));
    if (clean.length > 50000) throw new EngineError('invalid', t('err.messageTooLong'));
    const record = {
      role: 'user', text: clean, dispatchState: 'pending', ...(attachments.length ? { attachments } : {}),
      ...(request ? { clientMessageId: request.clientMessageId, clientMessageHash: request.fingerprint, dispatchState: 'pending' } : {}),
    };
    const message = await this.store.appendMessage(chatId, record);
    this.broadcast({ type: 'message.upsert', chatId, message });
    this.broadcastSummary(chatId);
    this.dispatchUserMessage(chatId, message, bot, group);
    return message;
  }

  dispatchUserMessage(chatId, message, bot, group) {
    this.inbox.enqueue(chatId, message, bot, group);
  }

  async runUserBatch(batch) {
    const { chatId, messages, bot, group } = batch;
    const cancelled = () => batch.cancelled || this.disposed;
    if (group) {
      const continued = await this.tasks.continueDiscussion(group, messages, cancelled);
      if (continued) return continued;
    }
    if (cancelled()) return skippedTurn();
    const sourceMessageIds = messages.map((message) => message.id);
    const text = messages.map((message) => agentTextOf(message.text, message.attachments)).join('\n\n');
    return bot
      ? this.runBotTurn({ bot, chatId, text, kind: 'private', sourceMessageId: sourceMessageIds[0], sourceMessageIds })
      : this.driveGroup(group, this.groupQueue(group, messages.map((message) => message.text).join('\n')), sourceMessageIds[0], sourceMessageIds);
  }

  async reportFailure(chatId, error) {
    this.logger.warn('minimax_bot.turn_failed', { code: errorCode(error) || 'unknown' });
    const message = await this.store.appendMessage(chatId, {
      role: 'system',
      key: 'notice.failed',
      params: { error: describeAgentError(error) },
      text: t('notice.failed', { error: describeAgentError(error) }),
      status: 'error',
    });
    this.broadcast({ type: 'message.upsert', chatId, message });
    this.broadcastSummary(chatId);
    this.emitBusy(chatId);
  }

  mentionsIn(text, group, excludeId) {
    const lower = String(text ?? '').toLowerCase();
    const members = group.memberIds.map((id) => this.store.getBot(id)).filter(Boolean)
      .map((bot) => ({ id: bot.id, name: bot.name.toLowerCase() }))
      .sort((a, b) => b.name.length - a.name.length);
    const isWord = (value) => Boolean(value && /[\p{L}\p{N}\p{M}_]/u.test(value));
    const found = [];
    for (let index = lower.indexOf('@'); index >= 0; index = lower.indexOf('@', index + 1)) {
      if (isWord(lower[index - 1])) continue;
      const member = members.find(({ name }) => lower.startsWith(name, index + 1) && !isWord(lower[index + 1 + name.length]));
      if (!member) continue;
      if (member.id !== excludeId && !found.includes(member.id)) found.push(member.id);
      index += member.name.length;
    }
    return found;
  }

  async runGroup(group, userText, sourceMessageId) {
    await this.driveGroup(group, this.groupQueue(group, userText), sourceMessageId);
  }

  /** Who speaks first on a new group message: whoever it @mentions, else the reply mode decides. */
  groupQueue(group, text) {
    const mentioned = this.mentionsIn(text, group);
    if (mentioned.length) return mentioned;
    const others = group.memberIds.filter((id) => id !== group.adminId);
    return group.replyMode === 'all' ? [group.adminId, ...others] : [group.adminId ?? group.memberIds[0]];
  }

  /**
   * Gives each queued member a turn in order, appending whoever a reply @mentions, until the
   * queue is empty, a no-progress loop is detected, or a member asks the user something. Used for
   * a new user message and to resume after a member's questionnaire is answered.
   * @param {any} group
   * @param {string[]} queue bot ids
   */
  async driveGroup(group, queue, sourceMessageId, sourceMessageIds, options = {}) {
    const chatId = `group:${group.id}`;
    const previous = this.groupLoops.get(chatId);
    if (previous) previous.cancelled = true;
    const loop = { cancelled: false };
    this.groupLoops.set(chatId, loop);
    this.emitBusy(chatId);
    let lastResult;
    let accepted = false;
    let paused;
    const seen = new Set();
    // F7 · the hop limit. 0 = no limit = the baseline behaviour: the chain runs as long as the
    // Bots hand over to each other.
    const limit = this.maxHops(group);
    /** How many Bots spoke in this chain so far. */
    let hops = 0;
    /** The conclusion of the last hop, handed over to the next one. */
    let lastConclusion;
    /** What the Bots said in this round, for the group's note. */
    const noteRound = [];
    /** Set when the chain stopped because of the hop limit. */
    let converged;
    try {
      while (queue.length && !loop.cancelled && !options.signal?.aborted && !this.disposed) {
        // The limit is reached and somebody is still queued: the chain converges instead of
        // relaying on. The queue is emptied on purpose — the chain ends here, so nobody is
        // left to be called later (the task dispatcher would otherwise resume it).
        if (limit > 0 && hops >= limit) {
          converged = { reason: 'hop_limit', max: limit };
          queue.length = 0;
          break;
        }
        const botId = /** @type {string} */ (queue.shift());
        const bot = this.store.getBot(botId);
        const fresh = this.store.getGroup(group.id);
        if (!bot || !fresh || !fresh.memberIds.includes(botId)) continue;
        // The conclusion of the previous hop rides along with this turn. It is prompt text, not
        // a model turn: the hand-over costs nothing.
        const handover = this.handoverFor(fresh, lastConclusion);
        hops += 1;
        const result = await this.runBotTurn({ bot, chatId, text: '', kind: 'group', sourceMessageId, sourceMessageIds, signal: options.signal, taskId: options.taskId, handover });
        lastResult = result;
        accepted ||= result.accepted;
        if (result.status === 'aborted' && (options.signal?.aborted || loop.cancelled)) queue.unshift(botId);
        if (result.safeToContinue === false) break;
        // Resume this member's verification under the same task before advancing the group.
        if (result.status === 'done' && result.waitingForTasks) break;
        if (result.status === 'done' && !result.pendingQuestion && PASS_RE.test(result.text)) {
          await this.store.updateMessage(chatId, result.messageId, { status: 'pass' });
          const updated = (await this.store.getMessages(chatId)).find((m) => m.id === result.messageId);
          this.broadcast({ type: 'message.upsert', chatId, message: updated });
          continue;
        }
        if (result.status === 'error' && !loop.cancelled) {
          // One member could not reply (its error and a retry button are in the chat): the round
          // goes on. If nobody else is queued, the admin picks it up so the user is not left hanging.
          if (!queue.length && fresh.adminId && fresh.adminId !== bot.id && fresh.memberIds.includes(fresh.adminId)) {
            queue.push(fresh.adminId);
          }
          continue;
        }
        // Waiting on the user (or stopped): the hand-off resumes from answerQuestion once they reply.
        if (result.status !== 'done' || result.pendingQuestion) break;
        if (result.text) {
          lastConclusion = { botId: bot.id, name: bot.name, text: result.text, ts: Date.now() };
          noteRound.push({ speaker: bot.name, text: result.text });
        }
        const next = this.mentionsIn(result.text, fresh, bot.id);
        // The limit is reached and the reply calls somebody: that Bot is not called, the chain
        // converges. This is the whole point of the limit — a chain that never ends.
        if (limit > 0 && hops >= limit && next.length) {
          converged = { reason: 'hop_limit', max: limit };
          break;
        }
        for (const id of next) if (!queue.includes(id)) queue.push(id);
        // Exact repeated handoffs without tool progress are a loop, not a turn budget.
        const signature = JSON.stringify([bot.id, result.text, next]);
        if (next.length && !result.toolCount && seen.has(signature)) { paused = 'no_progress'; break; }
        if (result.toolCount) seen.clear();
        else seen.add(signature);
      }
      if (converged) {
        // The chain stops here: the group is told why, and the Bot that just spoke wraps up.
        const wrap = await this.convergeGroup(group, chatId, converged, lastConclusion, {
          sourceMessageId, sourceMessageIds, signal: options.signal, taskId: options.taskId,
        });
        // The wrap-up is the conclusion of the round, so it belongs in the note.
        if (wrap.text && lastConclusion) noteRound.push({ speaker: lastConclusion.name, text: wrap.text });
      }
      // The group's note: what this round said. It is written from text the group already
      // produced, so it costs no turn, and a group that keeps no note is left alone.
      await this.recordGroupNote(group, noteRound);
      if (paused) {
        const note = await this.store.appendMessage(chatId, { role: 'system', key: 'notice.noProgress', text: t('notice.noProgress') });
        this.broadcast({ type: 'message.upsert', chatId, message: note });
        this.broadcastSummary(chatId);
      }
      if (!paused && loop.cancelled && queue.length) paused = 'interrupted';
      return { ...(lastResult ?? skippedTurn()), accepted, paused, remaining: [...queue] };
    } finally {
      if (this.groupLoops.get(chatId) === loop) this.groupLoops.delete(chatId);
      loop.cancelled = true;
      this.emitBusy(chatId);
      queueMicrotask(() => this.tasks.pump());
    }
  }

  async groupPrompt(group, bot, { handover } = {}) {
    const chatId = `group:${group.id}`;
    // The conclusion of the previous hop: text that rides along with this turn, no model turn.
    const hand = handover ? renderHandover(handover) : '';
    const head = [];
    if (hand) head.push(hand, '');
    const session = this.store.getSession(chatId, bot.id);
    // Legacy wall-clock cursors could mark unseen messages as read. Replay the bounded
    // context once when upgrading a session instead of perpetuating that missing history.
    const lastSeenSeq = session?.sessionId ? session.lastSeenSeq ?? 0 : 0;
    const all = await this.store.getMessages(chatId);
    const relevant = all.filter(
      (m) =>
        ((m.role === 'user' && ![
          'pending', 'held', 'adjusting', 'cancelled', 'uncertain', 'failed',
        ].includes(m.dispatchState)) || m.role === 'relay' || (m.role === 'bot' && m.status === 'done')) &&
        m.botId !== bot.id &&
        m.seq > lastSeenSeq,
    );
    const recent = relevant.slice(-GROUP_CONTEXT_MESSAGES);
    const lines = recent.map((m) => {
      const who =
        m.role === 'user'
          ? t('group.user')
          : m.role === 'relay'
            ? m.fromName ?? t('bot.deleted')
            : this.store.getBot(m.botId)?.name ?? t('bot.deleted');
      return `[${who}] ${clip(m.role === 'user' ? agentTextOf(m.text, m.attachments) : m.text)}`;
    });
    const text = [
      ...head,
      t('group.newMessages', { name: group.name }),
      ...(lines.length ? lines : [t('group.noNew')]),
      '',
      t('group.yourTurn', { name: bot.name }),
    ].join('\n');
    const lastIncluded = recent.at(-1)?.seq ?? lastSeenSeq;
    // Another member's streaming reply is not readable yet. Do not advance past that hole:
    // its eventual completion must still be delivered, even if newer user messages exist.
    const pending = all.find((m) => m.seq > lastSeenSeq && ((m.role === 'bot' && m.botId !== bot.id && m.status === 'streaming') || (m.role === 'user' && ['pending', 'held', 'adjusting'].includes(m.dispatchState))));
    return { text, memoryQuery: recent.findLast((message) => message.role === 'user' || message.role === 'relay')?.text ?? recent.at(-1)?.text ?? '', groupCursor: pending ? Math.min(lastIncluded, pending.seq - 1) : lastIncluded };
  }

  /** Capture group input only after this Bot owns its serial turn, including helper reports. */
  async prepareGroupInput(input) {
    if (input.answer || !input.chatId.startsWith('group:')) return { ...input, memoryQuery: input.memoryQuery ?? input.text };
    const group = this.store.getGroup(input.chatId.slice(6));
    if (!group) throw new EngineError('not_found', t('err.groupMissing'));
    const snapshot = await this.groupPrompt(group, input.bot, { handover: input.handover });
    // Freeze retrieval input from the same snapshot, including relayed new tasks.
    return { ...input, memoryQuery: input.memoryQuery ?? (input.text || snapshot.memoryQuery), groupCursor: snapshot.groupCursor, text: [snapshot.text, input.text].filter(Boolean).join('\n\n') };
  }

  /**
   * The user asks a failed reply to try again. The failed turn already holds their words, so the
   * Bot is asked to answer them now; in a group the hand-off continues as for any member turn.
   */
  async retryMessage(chatId, messageId) {
    const key = `${chatId}\u0000${messageId}`;
    if (this.retryRequests.has(key)) throw new EngineError('busy', t('err.stopFirst'));
    this.retryRequests.add(key);
    try {
      const messages = await this.store.getMessages(chatId);
      const message = messages.find((m) => m.id === messageId);
      if (!message || message.role !== 'bot' || message.status !== 'error' || !message.retryable) {
        throw new EngineError('invalid', t('err.cannotRetry'));
      }
      const bot = this.store.getBot(message.botId);
      if (!bot) throw new EngineError('not_found', t('err.botMissing'));
      const group = chatId.startsWith('group:') ? this.store.getGroup(chatId.slice(6)) : undefined;
      if (chatId.startsWith('group:') && (!group || !group.memberIds.includes(bot.id))) {
        throw new EngineError('not_found', t('err.groupMissing'));
      }
      if (this.isBusy(chatId)) throw new EngineError('busy', t('err.stopFirst'));
      // Commit the claim before dispatch. A disk failure leaves the same retry available;
      // the separate admission lock prevents two callers claiming it during the write.
      const text = message.retryInput ?? t('retry.continue');
      await this.store.updateMessage(chatId, message.id, { retryable: false, retryInput: undefined });
      this.broadcast({ type: 'message.upsert', chatId, message });
      const run = async () => {
        const result = await this.runBotTurn({ bot, chatId, text, kind: group ? 'group' : message.kind ?? 'private' });
        if (!group || result.status !== 'done' || result.pendingQuestion || PASS_RE.test(result.text)) return;
        const next = this.mentionsIn(result.text, group, bot.id);
        if (next.length) await this.driveGroup(group, next);
      };
      void run().catch((error) => this.reportFailure(chatId, error));
      return { ok: true };
    } finally { this.retryRequests.delete(key); }
  }

  async answerQuestion(chatId, messageId, answers) {
    const key = `${chatId}\u0000${messageId}`;
    if (this.answerRequests.has(key)) throw new EngineError('busy', t('err.answering'));
    this.answerRequests.add(key);
    try {
      const messages = await this.store.getMessages(chatId);
      const message = messages.find((m) => m.id === messageId);
      if (!message?.question || !message.sessionId) throw new EngineError('not_found', t('err.questionGone'));
      if (message.answering) throw new EngineError('busy', t('err.answering'));
      if (message.taskId && this.tasks.tasks.find((task) => task.id === message.taskId)?.status !== 'waiting_for_user') {
        throw new EngineError('invalid', t('task.answerUnavailable'));
      }
      const bot = this.store.getBot(message.botId);
      if (!bot) throw new EngineError('not_found', t('err.botMissing'));
      const question = message.question;
      const summary = (question.request?.steps ?? []).map((step) => {
        const picked = (answers.find((a) => a.stepId === step.id) ?? {});
        const labels = (step.options ?? [])
          .filter((option) => (picked.selectedOptionIds ?? []).includes(option.id))
          .map((option) => option.label);
        if (picked.otherText) labels.push(String(picked.otherText));
        return { question: String(step.question ?? ''), answer: labels.join(t('list.sep')) || t('answer.skipped') };
      });
      // Keep the questionnaire until the Host has taken the answer. Failed persistence
      // leaves the form unclaimed, and releases the admission lock for a safe retry.
      await this.store.updateMessage(chatId, messageId, { answering: true });
      this.broadcast({ type: 'message.upsert', chatId, message });
      void this.deliverAnswer({ chatId, message, question, answers, summary, bot }).catch((error) =>
        this.reportFailure(chatId, error),
      );
    } finally { this.answerRequests.delete(key); }
  }

  /** Runs the continuation turn, then settles the questionnaire by what the Host accepted. */
  async deliverAnswer({ chatId, message, question, answers, summary, bot }) {
    const run = (signal) => this.runBotTurn({
      bot,
      chatId,
      signal,
      text: '',
      kind: chatId.startsWith('group:') ? 'group' : 'private',
      taskId: message.taskId,
      answer: { sessionId: message.sessionId, requestId: question.requestId, answers },
    });
    const result = message.taskId ? await this.tasks.runAnswer(message.taskId, run) : await run();
    const notAccepted = result.skipped || ANSWER_NOT_ACCEPTED.has(result.errorCode ?? '');
    // Answered, or possibly answered (AGENT_OUTCOME_UNKNOWN): either way not resendable.
    await this.store.updateMessage(chatId, message.id, {
      answering: undefined,
      ...(!notAccepted ? { question: undefined, answered: true, answerSummary: summary } : {}),
    });
    this.broadcast({ type: 'message.upsert', chatId, message });
    this.broadcastSummary(chatId);
    if (message.taskId) return;
    if (notAccepted || !chatId.startsWith('group:')) return;
    // In a group the continuation is a normal member turn: hand off to whoever it @mentions.
    const group = this.store.getGroup(chatId.slice(6));
    if (!group || result.status !== 'done' || result.pendingQuestion || PASS_RE.test(result.text)) return;
    const next = this.mentionsIn(result.text, group, bot.id);
    if (next.length) await this.driveGroup(group, next);
  }

  async replyApproval(requestId, decision) {
    const approval = this.approvals.get(requestId);
    if (!approval) throw new EngineError('not_found', t('err.approvalGone'));
    if (!this.agent) throw new EngineError('agent_unavailable', t('err.agentUnavailable'));
    try {
      await this.agent.reply({
        sessionId: String(approval.sessionId),
        requestId,
        decision: decision === 'allowOnce' ? 'allowOnce' : 'deny',
      });
    } catch (error) {
      if (errorCode(error) !== 'REQUEST_NOT_FOUND') throw error;
    }
    this.approvals.delete(requestId);
    this.broadcast({ type: 'approval.removed', requestId });
    this.broadcastSummary(String(approval.chatId));
  }

  cancelChat(chatId) {
    this.tasks.stopChat(chatId);
    this.inbox.cancel(chatId);
    const loop = this.groupLoops.get(chatId);
    if (loop) loop.cancelled = true;
    let count = 0;
    // Turns still queued for this chat never start…
    for (const ticket of this.tickets) {
      if (ticket.chatId === chatId && !ticket.cancelled) {
        ticket.cancelled = true;
        ticket.controller.abort();
        count += 1;
      }
    }
    // …and the ones already running are aborted.
    for (const turn of this.running.values()) {
      if (turn.chatId === chatId) turn.controller.abort();
    }
    this.emitBusy(chatId);
    return count;
  }

  /** Stops every queued or running turn of a Bot, in any chat (used when it is deleted). */
  cancelBot(botId) {
    for (const batch of this.inbox.batches) if (batch.bot?.id === botId || batch.group?.memberIds.includes(botId)) this.inbox.cancel(batch.chatId);
    for (const helper of this.store.state.helpers ?? []) {
      if (helper.botId !== botId || !HELPER_ACTIVE.has(helper.status)) continue;
      // A deliberate cancel (the Bot was deleted) is a stop, not an interruption.
      const run = this.helperRuns.get(helper.id);
      if (run) {
        run.stoppedBy = run.stoppedBy ?? 'cancelled';
        run.controller.abort();
      }
    }
    const chats = new Set();
    for (const ticket of this.tickets) {
      if (ticket.botId === botId) {
        ticket.cancelled = true;
        ticket.controller.abort();
        chats.add(ticket.chatId);
      }
    }
    for (const turn of this.running.values()) {
      if (turn.botId === botId) {
        turn.controller.abort();
        chats.add(turn.chatId);
      }
    }
    for (const chatId of chats) this.emitBusy(chatId);
  }

  // ------------------------------------------------------------------ schedules
  startScheduler() {
    this.scheduleTimer = setInterval(() => void this.tickSchedules(), 30_000);
    this.scheduleTimer.unref?.();
    void this.tickSchedules();
  }

  async tickSchedules() {
    if (this.disposed) return;
    const now = Date.now();
    let changed = false;
    for (const schedule of [...this.store.state.schedules]) {
      if (!schedule.enabled) continue;
      if (!schedule.nextRunAt) {
        schedule.nextRunAt = nextRun(schedule, now);
        changed = true;
      }
      if (schedule.nextRunAt > now) continue;
      await this.fireSchedule(schedule, now, { save: false });
      changed = true;
    }
    if (changed) {
      await this.store.save();
      this.broadcast({ type: 'state.changed' });
    }
  }

  /**
   * Post a schedule's task into its Bot's chat and run a turn. A one-time reminder is removed
   * once it has fired; a recurring one moves on to its next run. Also used by "run now".
   */
  async fireSchedule(schedule, now = Date.now(), { save = true } = {}) {
    const bot = this.store.getBot(schedule.botId);
    schedule.lastRunAt = now;
    if (schedule.kind === 'once') {
      this.store.state.schedules = this.store.state.schedules.filter((s) => s.id !== schedule.id);
    } else {
      schedule.nextRunAt = nextRun(schedule, now + 1000);
    }
    if (save) {
      await this.store.save();
      this.broadcast({ type: 'state.changed' });
    }
    if (!bot) return;
    const chatId = `bot:${bot.id}`;
    const note = await this.store.appendMessage(chatId, {
      role: 'schedule',
      text: schedule.prompt,
      scheduleName: schedule.name,
    });
    this.broadcast({ type: 'message.upsert', chatId, message: note });
    this.broadcastSummary(chatId);
    void this.runBotTurn({
      bot,
      chatId,
      kind: 'schedule',
      text: `${t('schedule.trigger', { name: schedule.name })} ${schedule.prompt}`,
    }).catch((error) => this.reportFailure(chatId, error));
  }


  // ------------------------------------------------------------------ helpers
  /** Helper records as the page and `list_helpers` show them; the task text is clipped. */
  helperView(helper) {
    return {
      id: helper.id,
      botId: helper.botId,
      chatId: helper.chatId,
      title: helper.title,
      task: clip(helper.task, 600),
      status: helper.status,
      createdAt: helper.createdAt,
      startedAt: helper.startedAt,
      endedAt: helper.endedAt,
      sessionId: helper.sessionId,
      resultMessageId: helper.resultMessageId,
      error: helper.error,
    };
  }

  helpersList() {
    return (this.store.state.helpers ?? []).map((helper) => this.helperView(helper));
  }

  broadcastHelpers() {
    this.broadcast({ type: 'helpers.changed', helpers: this.helpersList() });
  }

  /**
   * A Bot hands heavy work to a helper: a fresh, hidden Agent session that works on `task` on its
   * own while the Bot's turn ends and the user can keep chatting. When it finishes, its report
   * comes back to the Bot as a new turn in the chat the Bot was in, and the Bot relays it.
   * @param {any | undefined} caller
   * @param {{ task?: unknown, title?: unknown }} input
   */
  async startHelper(caller, input, invocation) {
    if (!caller) throw new EngineError('forbidden', t('err.helperNeedsBot'));
    if (!this.agent) throw new EngineError('agent_unavailable', t('err.noAgentSupport'));
    const callerTurn = this.requireCallerTurn(caller, invocation);
    const task = String(input.task ?? '').trim();
    if (!task) throw new EngineError('invalid', t('err.helperNoTask'));
    const helpers = (this.store.state.helpers ??= []);
    if (helpers.filter((h) => h.botId === caller.id && HELPER_ACTIVE.has(h.status)).length >= MAX_HELPERS_PER_BOT) {
      throw new EngineError('invalid', t('err.helperLimit', { n: MAX_HELPERS_PER_BOT }));
    }
    const title = (String(input.title ?? '').trim() || task.replace(/\s+/g, ' ')).slice(0, 40);
    // The report goes back to the chat the Bot is working in (a group or its own chat).
    const chatId = callerTurn.chatId;
    const helper = {
      id: newId('hlp'),
      botId: caller.id,
      chatId,
      title,
      task: clip(task, 20000),
      status: 'queued',
      createdAt: Date.now(),
    };
    helper.parentTaskId = this.tasks.attachDependency(callerTurn, 'helper', helper.id);
    helpers.push(helper);
    this.trimHelpers();
    try { await this.store.save(); }
    catch (error) {
      this.store.state.helpers = this.store.state.helpers.filter((item) => item.id !== helper.id);
      this.tasks.detachDependency(helper.parentTaskId, helper.id);
      throw error;
    }
    if (!this.isActiveTurn(callerTurn)) {
      helper.status = 'stopped';
      helper.endedAt = Date.now();
      await this.store.save();
      this.broadcastHelpers();
      throw new EngineError('busy', t('err.callerTurnMissing'));
    }
    this.broadcastHelpers();
    void this.runHelper(helper).catch((error) => this.logger.warn('minimax_bot.helper_failed', { code: errorCode(error) || 'unknown' }));
    return helper;
  }

  /** Keeps every active helper and the most recent finished ones. */
  trimHelpers() {
    const helpers = this.store.state.helpers ?? [];
    const finished = helpers.filter((h) => !HELPER_ACTIVE.has(h.status) &&
      !this.tasks.pendingDependencies(this.tasks.task(h.parentTaskId)).some((dependency) => dependency.id === h.id));
    if (finished.length <= 30) return;
    const drop = new Set(finished.slice(0, finished.length - 30).map((h) => h.id));
    this.store.state.helpers = helpers.filter((h) => !drop.has(h.id));
  }

  /** Waits for a helper turn; resolves false when the helper was stopped while it waited. */
  async acquireHelper(signal) {
    if (this.helperActive >= MAX_RUNNING_HELPERS) {
      await new Promise((resolve) => {
        const wake = () => {
          signal.removeEventListener('abort', onAbort);
          resolve(undefined);
        };
        const onAbort = () => {
          this.helperWaiters = this.helperWaiters.filter((w) => w !== wake);
          resolve(undefined);
        };
        this.helperWaiters.push(wake);
        signal.addEventListener('abort', onAbort, { once: true });
      });
      if (signal.aborted) return false;
    }
    this.helperActive += 1;
    return true;
  }

  releaseHelper() {
    this.helperActive -= 1;
    this.helperWaiters.shift()?.();
  }

  async runHelper(helper) {
    const controller = new AbortController();
    const run = { controller };
    const approvals = new Set();
    this.helperRuns.set(helper.id, run);
    let holdsHelper = false;
    let result;
    let failure = '';
    let aborted = false;
    try {
      holdsHelper = await this.acquireHelper(controller.signal);
      if (!holdsHelper || controller.signal.aborted) throw Object.assign(new Error('stopped'), { code: 'REQUEST_CANCELLED' });
      const acquired = await this.acquireSlot(controller.signal);
      if (!acquired) throw Object.assign(new Error('stopped'), { code: 'REQUEST_CANCELLED' });
      try {
        if (controller.signal.aborted) throw Object.assign(new Error('stopped'), { code: 'REQUEST_CANCELLED' });
        const bot = this.store.getBot(helper.botId);
        helper.status = 'running';
        helper.startedAt = Date.now();
        await this.store.save();
        this.broadcastHelpers();
        // A background task runs as its Bot would: same model and effort.
        const model = bot ? await this.turnModel(bot, undefined) : undefined;
        /** @param {MiniAppAgentRunEvent} event */
        const onEvent = (event) => {
          if (event.type === 'turn.started' && !helper.sessionId) {
            helper.sessionId = event.sessionId;
            this.broadcastHelpers();
          } else if (event.type === 'permission.requested') {
            // The user approves a helper's tool call in its Bot's chat, like the Bot's own.
            const approval = {
              requestId: event.requestId,
              sessionId: event.sessionId,
              chatId: helper.chatId,
              botId: helper.botId,
              helperId: helper.id,
              helperTitle: helper.title,
              toolName: event.toolName,
              toolInput: clip(event.toolInput ?? '', 1500),
              reason: event.reason,
              ts: Date.now(),
            };
            this.approvals.set(event.requestId, approval);
            approvals.add(approval);
            this.broadcast({ type: 'approval.added', approval });
            this.broadcastSummary(helper.chatId);
          }
        };
        const text = t('helper.brief', { bot: bot?.name ?? 'Bot', role: bot?.role || '-', task: helper.task });
        try {
          result = await /** @type {any} */ (this.agent).run({ text, ...(model ? { model } : {}) }, { signal: controller.signal, onEvent });
        } catch (error) {
          if (model && errorCode(error) === 'INVALID_ARGUMENTS') {
            throw Object.assign(new Error(errorText(error)), { code: 'MODEL_UNAVAILABLE' });
          }
          throw error;
        }
      } finally {
        this.releaseSlot();
      }
    } catch (error) {
      // An abort is not a failure: the run was cut off (Mini App restart, a stop, or the runtime
      // ending the turn). Only a real error becomes a failure with a message.
      if (!controller.signal.aborted && !this.disposed) failure = describeAgentError(error);
      else aborted = true;
    } finally {
      if (holdsHelper) this.releaseHelper();
      this.helperRuns.delete(helper.id);
      this.clearRunApprovals(approvals, helper.chatId);
    }
    if (result?.sessionId) helper.sessionId = result.sessionId;
    helper.endedAt = Date.now();
    let report = '';
    if (this.disposed) helper.status = 'interrupted';
    else if (run.stoppedBy) helper.status = 'stopped';
    else if (aborted || result?.status === 'aborted') {
      // Cut off without an error: the Mini App restarted, or the runtime ended the turn.
      helper.status = 'interrupted';
    } else if (failure) {
      helper.status = 'failed';
      helper.error = failure;
    } else if (result?.pendingQuestion) {
      // Helpers must not ask the user; a question it asked anyway goes back to its Bot to ask.
      helper.status = 'blocked';
      const steps = result.pendingQuestion.request?.steps ?? [];
      report = [clip(result.text ?? '', HELPER_REPORT_CLIP), ...steps.map((step) => `? ${step.question}`)].filter(Boolean).join('\n');
    } else if (result?.status === 'finished') {
      helper.status = 'done';
      report = clip(result.text ?? '', HELPER_REPORT_CLIP);
    } else {
      helper.status = 'failed';
      helper.error = result?.error?.message ?? t('agentError.unknown');
    }
    if (report) helper.report = report;
    if (this.disposed) return;
    this.trimHelpers();
    await this.store.save();
    this.broadcastHelpers();
    await this.deliverHelperReport(helper, run.stoppedBy);
  }

  /** Posts the helper's outcome into its chat and, unless it was stopped, gives its Bot a turn to relay it. */
  async deliverHelperReport(helper, stoppedBy) {
    const bot = this.store.getBot(helper.botId);
    if (!bot) return;
    const { chatId } = helper;
    const group = chatId.startsWith('group:') ? this.store.getGroup(chatId.slice(6)) : undefined;
    if (chatId.startsWith('group:') && (!group || !group.memberIds.includes(bot.id))) return;
    const note = await this.store.appendMessage(chatId, {
      role: 'helper',
      botId: bot.id,
      helperId: helper.id,
      title: helper.title,
      helperStatus: helper.status,
      stoppedBy,
      text: helper.title,
    });
    this.broadcast({ type: 'message.upsert', chatId, message: note });
    this.broadcastSummary(chatId);
    helper.resultMessageId = note.id;
    await this.store.save();
    this.broadcastHelpers();
    if (helper.parentTaskId) {
      await this.tasks.receiveDependency(helper.parentTaskId, helper.id, this.tasks.helperReport(helper));
      return;
    }
    // A stopped helper was stopped on purpose; there is nothing for the Bot to relay.
    if (helper.status === 'stopped') return;
    const text = t(`helper.trigger.${helper.status}`, {
      title: helper.title,
      id: helper.id,
      report: helper.report || '-',
      error: helper.error || '-',
    });
    const result = await this.runBotTurn({ bot, chatId, text, kind: group ? 'group' : 'helper' });
    if (result.messageId) {
      helper.resultMessageId = result.messageId;
      await this.store.save();
      this.broadcastHelpers();
    }
    // In a group the relay is a normal member turn: hand off to whoever it @mentions.
    if (!group || result.status !== 'done' || result.pendingQuestion || PASS_RE.test(result.text)) return;
    const next = this.mentionsIn(result.text, group, bot.id);
    if (next.length) await this.driveGroup(group, next);
  }

  /** Stops a queued or running helper. A Bot may stop its own; a main Bot and the user any. */
  stopHelper(caller, id) {
    const helper = (this.store.state.helpers ?? []).find((h) => h.id === String(id ?? ''));
    if (!helper) throw new EngineError('not_found', t('err.helperMissing', { id: String(id ?? '') }));
    if (caller && !caller.isMain && helper.botId !== caller.id) throw new EngineError('forbidden', t('err.helperNotYours'));
    const run = this.helperRuns.get(helper.id);
    if (!run || !HELPER_ACTIVE.has(helper.status)) return { stopped: false, status: helper.status };
    run.stoppedBy = caller ? caller.name : 'user';
    run.controller.abort();
    return { stopped: true, status: 'stopped' };
  }

  dispose() {
    this.disposed = true;
    this.tasks.dispose();
    this.inbox.cancel(undefined, { persist: false });
    for (const ticket of this.tickets) ticket.controller.abort();
    for (const run of this.helperRuns.values()) run.controller.abort();
    if (this.scheduleTimer) clearInterval(this.scheduleTimer);
    for (const loop of this.groupLoops.values()) loop.cancelled = true;
    for (const turn of this.running.values()) turn.controller.abort();
  }
}

/** Next run time for a daily (HH:MM) or interval schedule. */
export function nextRun(schedule, from) {
  // A one-time reminder keeps its fixed moment.
  if (schedule.kind === 'once') return Number(schedule.runAt) || from;
  if (schedule.kind === 'interval') {
    const minutes = Math.max(5, Number(schedule.everyMinutes) || 60);
    return from + minutes * 60_000;
  }
  const [h, m] = String(schedule.time ?? '09:00')
    .split(':')
    .map((n) => Number(n));
  const next = new Date(from);
  next.setHours(Number.isFinite(h) ? h : 9, Number.isFinite(m) ? m : 0, 0, 0);
  if (next.getTime() <= from) next.setDate(next.getDate() + 1);
  return next.getTime();
}

export function describeAgentError(error) {
  const code = errorCode(error);
  const key = `agentError.${code}`;
  const text = code ? t(key) : key;
  if (text !== key) return text;
  return errorText(error) || t('agentError.unknown');
}
