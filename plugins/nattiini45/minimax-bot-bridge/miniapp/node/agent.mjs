/**
 * Runs Bot turns.
 *
 * A turn belongs to the Bot or the group the phone addressed, and there are two ways to
 * run it:
 *
 * - **team** — the `@minimax-bot` team runs the turn: that Bot answers with its own
 *   instructions, its own model and effort, in its own session, and its reply lands in
 *   its own conversation.
 * - **hosted** — the desktop runs the turn under the bridge, in that Bot's own session.
 *   The Host only lets the Mini App that owns a run answer its questions, so this is
 *   where a permission check or a questionnaire the Bot raises can be answered from the
 *   phone. A group is always the team's: who speaks first and who hands over to whom
 *   are the product's rules.
 *
 * The Host's agent capability is used for both: a hosted turn runs on it, and an
 * answer to a question the Host asked is given back to it.
 */

import { desktopTurnById, desktopTurnsByTask } from './desktop-team.mjs';

/** Mirrors the Host's agent concurrency ceiling. */
export const MAX_CONCURRENT_RUNS = 32;

/**
 * How many Bot conversations the bridge keeps a note of at once.
 *
 * The team owns the conversations; the bridge only remembers which session answered
 * last, so that a phone that asks about it gets an answer. The chat id is chosen by
 * the client, so without a ceiling a client that keeps inventing chats makes the
 * desktop hold a note for each of them.
 */
export const MAX_BOT_SESSIONS = 50;

export class AgentRunner {
  /**
   * @param {import('./contracts.d.ts').HostContext} context the Mini App context
   * @param {{pending?: import('./pending.mjs').PendingSet, router?: import('./bot-router.mjs').BotRouter,
   *   onEvent?: (type: string, payload: object, mode?: string) => void,
   *   onTurnFinished?: (info: {chatId: string, durationMs: number, result?: import('./contracts.d.ts').HostRunResult, error?: unknown}) => unknown,
   *   onTeamAccepted?: (turn: import('./contracts.d.ts').TeamTurn) => unknown}} [options]
   */
  constructor(context, { pending, onEvent, onTurnFinished, onTeamAccepted, router } = {}) {
    this.context = context;
    this.pending = pending;
    this.stopped = false;
    this.generation = 0;
    this.watchers = new Set();
    this.turnModes = new Map();
    this.pendingScopes = new WeakMap();
    this.onEvent = (type, payload) => {
      if (this.stopped) return;
      const turnId = payload?.turnId ?? payload?.message?.turnId;
      onEvent?.(type, payload, this.turnModes.get(turnId) ?? 'hosted');
    };
    if (pending) pending.onExpired = (requestId, item) => this.resolveEvent(requestId, item, 'expired');
    this.onTurnFinished = onTurnFinished ?? (() => {});
    this.onTeamAccepted = onTeamAccepted ?? (() => {});
    /** @type {import('./bot-router.mjs').BotRouter} */
    this.router = router;
    /** @type {Map<string, string>} chatId -> the session the Bot answered in */
    this.sessions = new Map();
    /** @type {Map<string, AbortController>} turnId -> controller */
    this.aborts = new Map();
    /** @type {Map<string, {batchId: string, taskId?: string}>} turnId -> the team's task */
    this.turns = new Map();
    /**
     * The tool calls a Host run reported, so that a call that never reported back does
     * not stay on the phone for ever.
     *
     * @type {Map<string, Map<string, Array<{callId: string, startedAt: number}>>>}
     */
    this.toolCalls = new Map();
    this.callCounter = 0;
    this.activeRuns = 0;
  }

  /**
   * Remembers a tool call the Host reported.
   *
   * A turn may call the same tool more than once, so the calls of a tool are kept in
   * the order they were started: a finish belongs to the oldest call that is still
   * waiting.
   *
   * @param {string} turnId
   * @param {string} name
   */
  startTool(turnId, name) {
    this.callCounter += 1;
    const callId = `call_${this.callCounter}`;
    const calls = this.toolCalls.get(turnId) ?? new Map();
    const queue = calls.get(name) ?? [];
    queue.push({ callId, startedAt: Date.now() });
    calls.set(name, queue);
    this.toolCalls.set(turnId, calls);
    return callId;
  }

  /**
   * Forgets a tool call the Host reported.
   *
   * @param {string} turnId
   * @param {string} name
   */
  finishTool(turnId, name) {
    const calls = this.toolCalls.get(turnId);
    const queue = calls?.get(name);
    const call = queue?.shift();
    if (!calls) return call;
    if (queue && queue.length === 0) calls.delete(name);
    // The turn's bookkeeping goes only when nothing of it is left.
    if (calls.size === 0) this.toolCalls.delete(turnId);
    return call;
  }

  /**
   * Forgets every tool call of a turn, so that a call which never reported back does
   * not stay on the phone for ever.
   *
   * @param {string} turnId
   */
  clearTools(turnId) {
    this.toolCalls.delete(turnId);
  }

  /** Whether a turn can be handed to the team right now. */
  get available() {
    return Boolean(this.router?.available);
  }

  sessionFor(chatId) {
    return this.sessions.get(chatId);
  }

  /**
   * Remembers which session answered in a conversation.
   *
   * The team owns the conversations; the bridge only keeps a note of which session
   * answered last, so that a phone that asks about it gets an answer. The chat id is
   * chosen by the client, so without a ceiling a client that keeps inventing chats
   * makes the desktop hold a note for each of them.
   *
   * @param {string} chatId
   * @param {string} sessionId
   */
  rememberSession(chatId, sessionId) {
    if (!sessionId) return;
    this.sessions.set(chatId, sessionId);
    while (this.sessions.size > MAX_BOT_SESSIONS) {
      const oldest = this.sessions.keys().next();
      if (oldest.done) break;
      this.sessions.delete(oldest.value);
    }
  }

  /**
   * Runs a turn for a chat.
   *
   * A private Bot chat runs on the desktop under the bridge by default, in that Bot's
   * own session, so that a permission check or a questionnaire the Bot raises can be
   * answered from the phone: the Host lets the Mini App that owns a run answer its
   * questions, and the team keeps a run to itself. A phone can ask for the team's own
   * engine instead, where the desktop Bot app keeps the whole exchange.
   *
   * A group chat always runs in the team, because a group is more than a Bot: who
   * speaks first, who the admin is, who hands over to whom and when the discussion
   * pauses are the team's rules, and the phone does not get to make them up.
   *
   * @param {{chatId: string, text: string, mentions?: string[], requestId?: string, mode?: 'team' | 'hosted'}} input
   */
  async run(input) {
    this.assertRunning();
    const route = this.router?.route?.(input.chatId);
    if (route?.kind === 'bot' && input.mode !== 'team') return this.runHosted(input);
    return this.runTeam(input);
  }

  /**
   * The exchange the desktop recorded for a turn the team ran.
   *
   * The desktop keeps one record per turn, and that record holds everything the turn
   * did. It is found by the task the turn ran under — a group can have more than one
   * record for one turn, and they share that task — and by the id the receipt names.
   *
   * @param {string} chatId
   * @param {string | undefined} messageId the id of the record the receipt named
   * @param {string | undefined} taskId the task the turn ran under
   * @returns {Promise<{messages: Array<import('./contracts.d.ts').ChatMessage>, activity: Array<import('./contracts.d.ts').TurnActivity>} | undefined>}
   */
  async readTeamExchange(chatId, messageId, taskId) {
    const byTask = await desktopTurnsByTask(this.context, chatId, taskId);
    if (byTask && byTask.messages.length > 0) return byTask;
    const byId = await desktopTurnById(this.context, chatId, messageId);
    if (byId && byId.messages.length > 0) return byId;
    return undefined;
  }

  /**
   * Publishes the exchange the desktop recorded.
   *
   * Every part the desktop draws as a bubble becomes a message on the phone, and every
   * tool the turn used becomes a call, so that the phone shows the same conversation
   * the desktop shows and not only the answer at the end of it.
   *
   * @param {string} chatId
   * @param {string} turnId the turn these belong to
   * @param {{messages: Array<import('./contracts.d.ts').ChatMessage>, activity: Array<import('./contracts.d.ts').TurnActivity>}} exchange
   */
  publishExchange(chatId, turnId, exchange) {
    const previous = this.turnModes.get(turnId);
    this.turnModes.set(turnId, 'team');
    for (const message of exchange.messages) {
      this.onEvent('evt.message_committed', {
        message: { ...message, chatId, turnId },
      });
    }
    for (const entry of exchange.activity) {
      this.onEvent('evt.tool_started', {
        chatId,
        turnId,
        toolName: entry.toolName,
        callId: entry.callId,
      });
      this.onEvent('evt.tool_finished', {
        chatId,
        turnId,
        toolName: entry.toolName,
        callId: entry.callId,
        ok: entry.status === 'ok',
        // The state is carried as well as the yes or the no, so that a call the desktop
        // never saw report back looks the same on the phone as it does in the thread
        // the phone reads back.
        status: entry.status,
        // A call the desktop never saw report back is not a failure, but it is not a
        // success either, so it says what is known rather than what is not.
        ...(entry.status === 'unknown'
          ? { error: 'The tool did not report back before the turn ended.' }
          : entry.status === 'failed'
            ? { error: 'The tool did not finish.' }
            : {}),
      });
    }
    if (previous) this.turnModes.set(turnId, previous);
    else this.turnModes.delete(turnId);
  }

  /**
   * Runs a turn the team owns.
   *
   * @param {{chatId: string, text: string, mentions?: string[], requestId?: string}} input
   */
  async runTeam(input) {
    this.assertRunning();
    if (!this.router?.available) {
      throw codedError(
        'TEAM_UNAVAILABLE',
        'The @minimax-bot team is not running on this desktop. Open MiniMax Bot to link it.',
        true,
      );
    }
    if (this.activeRuns >= MAX_CONCURRENT_RUNS) {
      throw codedError('BUSY', 'Too many turns are already running.', true);
    }

    const { chatId, text, mentions, requestId } = input;
    const controller = new AbortController();
    const generation = this.generation;
    const current = () => !this.stopped && generation === this.generation;
    this.watchers.add(controller);
    this.activeRuns += 1;
    const startedAt = Date.now();

    let result;
    let failure;
    /** @type {string | undefined} */
    let turnId;
    try {
      // The team takes the turn and answers with a receipt; the work itself runs in the
      // Bot's own conversation, wherever the user opened it.
      const turn = await this.router.send({ chatId, text, mentions, requestId, signal: controller.signal });
      turnId = turn.taskId ?? turn.batchId;
      if (!current()) return;
      this.onTeamAccepted(turn);
      this.turnModes.set(turnId, 'team');
      this.turns.set(turnId, turn);
      this.aborts.set(turnId, controller);
      this.onEvent('evt.turn_started', { chatId, turnId, startedAt: Date.now() });

      const settled = await this.router.wait(turn, { signal: controller.signal });
      if (!current()) return settled;

      if (settled.sessionId) {
        this.rememberSession(chatId, settled.sessionId);
      }

      const reply = settled.text ?? '';
      // The desktop keeps the whole exchange of a turn the team ran, and the names of
      // that exchange come back with the receipt. Reading it back gives the phone the
      // same bubbles the desktop shows: what the Bot said while it worked, the tools
      // it used, and the answer it ended with.
      const exchange = await this.readTeamExchange(chatId, settled.messageId, settled.taskId);
      if (!current()) return settled;
      if (exchange) {
        this.publishExchange(chatId, turnId, exchange);
      } else if (reply) {
        // The desktop's own record could not be read. The answer is still the answer,
        // so it is published as one message rather than lost.
        this.onEvent('evt.message_chunk', {
          chatId,
          turnId,
          messageId: messageIdFor(chatId, turnId),
          text: reply,
          final: true,
        });
        this.onEvent('evt.message_committed', {
          message: {
            messageId: messageIdFor(chatId, turnId),
            chatId,
            role: 'assistant',
            text: reply,
            ts: Date.now(),
            turnId,
            // The Bot that answered is the Bot the turn was addressed to.
            authorId: settled.botId ?? authorIdFor(chatId),
          },
        });
      }
      if (settled.note) {
        // The team stopped for a reason the phone has to know about, and it is not the
        // Bot's words, so it is not put in the Bot's mouth.
        this.onEvent('evt.message_committed', {
          message: {
            messageId: `${messageIdFor(chatId, turnId)}_note`,
            chatId,
            role: 'system',
            text: settled.note,
            ts: Date.now(),
          },
        });
      }

      result = { ...settled, turnId, sessionId: settled.sessionId ?? this.sessions.get(chatId) };
      this.onEvent('evt.turn_finished', {
        chatId,
        turnId,
        status: settled.status === 'cancelled' ? 'aborted' : 'finished',
        reason: settled.status === 'cancelled' ? 'cancelled' : undefined,
        text: reply,
      });
      return result;
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      this.activeRuns -= 1;
      this.watchers.delete(controller);
      if (turnId) {
        if (this.aborts.get(turnId) === controller) this.aborts.delete(turnId);
        this.turns.delete(turnId);
        if (!this.router.polls?.has(turnId)) this.router.turns?.delete(turnId);
        // A tool call that never reported back must not stay on the phone for ever.
        this.clearTools(turnId);
      }
      // A turn that failed still has to be reported, or the phone is left waiting on a
      // reply that will never come. A turn that was stopped is not a failure.
      if (current() && failure) {
        const stopped = /** @type {any} */ (failure).code === 'CANCELLED';
        this.onEvent('evt.turn_finished', {
          chatId,
          turnId,
          status: stopped ? 'aborted' : 'error',
          reason: stopped ? 'cancelled' : 'error',
          error: {
            code: /** @type {any} */ (failure).code ?? 'TURN_FAILED',
            message: failure instanceof Error ? failure.message : String(failure),
          },
        });
      }
      if (current()) await this.onTurnFinished?.({
        chatId,
        durationMs: Date.now() - startedAt,
        result,
        error: failure,
      });
      if (turnId) this.turnModes.delete(turnId);
    }
  }

  /**
   * Runs a turn the bridge owns, in the Bot's own session.
   *
   * @param {{chatId: string, text: string, mentions?: string[], requestId?: string}} input
   */
  async runHosted(input) {
    this.assertRunning();
    if (!this.context.agent) {
      throw codedError('AGENT_UNAVAILABLE', 'The desktop agent is not available, so the Bot cannot be run from here.', true);
    }
    if (this.activeRuns >= MAX_CONCURRENT_RUNS) {
      throw codedError('BUSY', 'Too many turns are already running.', true);
    }
    const { chatId, text } = input;
    return this.observeHosted(chatId, (options) => this.router.hosted({
      chatId, botId: this.router.route(chatId)?.targetId ?? '', text, ...options,
    }));
  }

  /** One lifecycle for a new hosted run and a questionnaire continuation. */
  async observeHosted(chatId, execute, { continuation = false } = {}) {
    const controller = new AbortController();
    const generation = this.generation;
    const current = () => !this.stopped && generation === this.generation;
    this.watchers.add(controller);
    this.activeRuns += 1;
    const startedAt = Date.now();
    let result;
    let failure;
    let terminal;
    let turnId;
    const observedTurns = new Set();
    const requestedQuestions = new Set();
    const requestedIds = new Set();
    try {
      const run = await execute({ signal: controller.signal, onEvent: (event) => {
        if (!current()) return;
        // Child permissions name the child's turn, not the root continuation.
        if (event.turnId) {
          observedTurns.add(event.turnId);
          this.turnModes.set(event.turnId, 'hosted');
          if (event.type !== 'permission.requested') turnId = event.turnId;
        }
        if (event.type === 'question.requested') requestedQuestions.add(event.requestId);
        if (event.type === 'question.requested' || event.type === 'permission.requested') requestedIds.add(event.requestId);
        if (event.type === 'turn.finished') terminal = event;
        this.handleAgentEvent(chatId, event, controller);
      } });
      if (!current()) return run;
      turnId = run.turnId ?? turnId ?? run.pendingQuestion?.turnId;
      if (turnId) { observedTurns.add(turnId); this.turnModes.set(turnId, 'hosted'); }
      if (run.sessionId) {
        this.rememberSession(chatId, run.sessionId);
        this.router?.rememberPhoneSession?.(chatId, run.sessionId);
      }
      if (run.pendingQuestion && !requestedQuestions.has(run.pendingQuestion.requestId)) {
        requestedIds.add(run.pendingQuestion.requestId);
        this.handleAgentEvent(chatId, {
          ...run.pendingQuestion, type: 'question.requested', sessionId: run.sessionId,
          turnId: run.pendingQuestion.turnId ?? turnId,
        }, controller);
      }
      result = { ...run, turnId };
      return result;
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      this.activeRuns -= 1;
      this.watchers.delete(controller);
      for (const observed of observedTurns) {
        if (this.aborts.get(observed) === controller) this.aborts.delete(observed);
        this.clearTools(observed);
      }
      if (current() && (!continuation || observedTurns.size > 0)) {
        // A questionnaire ends a Host turn with status "finished". Only the
        // result's pendingQuestion distinguishes waiting from terminal completion.
        const waiting = Boolean(result?.pendingQuestion) || result?.status === 'waiting_for_user';
        if (!waiting && (result || observedTurns.size > 0)) this.clearPending((item) =>
          requestedIds.has(item.request.requestId) || (item.request.chatId === chatId &&
          !this.watchers.has(this.pendingScopes.get(item))));
        if (!terminal) {
          const cancelled = /** @type {any} */ (failure)?.code === 'CANCELLED' ||
            (failure instanceof Error && failure.name === 'AbortError');
          const status = cancelled || result?.status === 'aborted' ? 'aborted' :
            failure || result?.status === 'error' ? 'error' : 'finished';
          this.onEvent('evt.turn_finished', {
            chatId, turnId, status,
            reason: status === 'aborted' ? 'cancelled' : status === 'error' ? 'error' : undefined,
            text: result?.text,
            error: failure ? { code: /** @type {any} */ (failure).code ?? 'TURN_FAILED',
              message: failure instanceof Error ? failure.message : String(failure) } : result?.error,
          });
        }
        await this.onTurnFinished?.({ chatId, durationMs: Date.now() - startedAt,
          result: result ?? terminal, error: failure });
      }
      for (const observed of observedTurns) this.turnModes.delete(observed);
    }
  }

  assertRunning() {
    if (this.stopped) throw codedError('BRIDGE_STOPPED', 'The bridge has stopped.');
  }

  /** Stop observing owned runs, without cancelling official team tasks. */
  stop() {
    this.stopped = true;
    this.generation += 1;
    for (const controller of this.watchers) controller.abort();
    this.aborts.clear();
    this.toolCalls.clear();
    this.turnModes.clear();
    this.clearPending(() => true);
  }

  resolveEvent(requestId, item, reason) {
    this.onEvent(item.kind === 'permission' ? 'evt.permission_resolved' : 'evt.question_answered', { requestId, reason });
  }

  clearPending(predicate) {
    for (const item of this.pending?.list() ?? []) {
      if (predicate(item) && this.pending.resolve(item.request.requestId)) {
        this.resolveEvent(item.request.requestId, item, 'turn_ended');
      }
    }
  }

  /**
   * Stops a running turn.
   *
   * The team's work is not a Host run the bridge owns, so stopping it means telling the
   * team to stop: the work it already admitted has to be cancelled there.
   *
   * @param {string} turnId
   */
  async abort(turnId) {
    const controller = this.aborts.get(turnId);
    const turn = this.turns.get(turnId);
    if (!controller && !turn) return false;
    // A remote refusal must leave the watcher alive and the cancel retryable.
    if (turn && await this.router.cancel(turn) === false) return false;
    // The poll may have settled while remote cancellation was in flight.
    if (this.aborts.get(turnId) !== controller && !this.turns.has(turnId)) return false;
    controller?.abort();
    if (this.aborts.get(turnId) === controller) this.aborts.delete(turnId);
    return true;
  }

  /** Answers a pending permission request. */
  async reply(requestId, decision) {
    this.assertRunning();
    // The agent API accepts exactly two decisions. Anything else — including
    // `allowAlways` — is refused here rather than forwarded to the Host.
    if (decision !== 'allowOnce' && decision !== 'deny') {
      throw codedError('INVALID_ARGUMENTS', 'A decision must be either allowOnce or deny.', false);
    }
    // The request is claimed before the Host is called. Two answers to the same
    // request must not both reach the Host: the second one finds nothing to answer
    // and is refused.
    const item = this.pending?.claim(requestId, 'permission');
    if (!item) {
      throw codedError('REQUEST_NOT_FOUND', 'That request is no longer waiting for an answer.', false);
    }
    const claimId = item.claimId;
    // Completion work must remain possible when every run slot is occupied.
    if (!this.context.agent) {
      this.pending?.release(requestId, claimId);
      throw codedError('AGENT_UNAVAILABLE', 'The agent is not available on this desktop.', true);
    }
    const generation = this.generation;
    this.activeRuns += 1;
    try {
      await this.context.agent.reply({
        sessionId: item.sessionId,
        requestId,
        decision,
      });
      if (!this.stopped && generation === this.generation && this.pending.resolve(requestId)) {
        this.onEvent('evt.permission_resolved', { requestId, decision });
      }
    } catch (error) {
      // The Host did not take the answer, so the request is still waiting for one and
      // the phone is allowed to give it again.
      this.pending?.release(requestId, claimId);
      throw error;
    } finally {
      this.activeRuns -= 1;
    }
  }

  /** Answers a pending questionnaire and observes the continuation turn. */
  async answer(requestId, answers) {
    this.assertRunning();
    const item = this.pending?.claim(requestId, 'question');
    if (!item) {
      throw codedError('REQUEST_NOT_FOUND', 'That request is no longer waiting for an answer.', false);
    }
    const claimId = item.claimId;
    if (!this.context.agent) {
      this.pending?.release(requestId, claimId);
      throw codedError('AGENT_UNAVAILABLE', 'The agent is not available on this desktop.', true);
    }
    // Keep the owning chat on the request: the bounded session index can evict it.
    const chatId = item.request.chatId ?? this.chatIdForSession(item.sessionId);
    const generation = this.generation;
    let continued = false;
    try {
      const result = await this.observeHosted(chatId, (options) => this.context.agent.answer(
        { sessionId: item.sessionId, requestId, answers: normaliseAnswers(answers) },
        { ...options, onEvent: (event) => {
          if (event.type === 'turn.started') continued = true;
          options.onEvent(event);
        } },
      ), { continuation: true });
      if (this.stopped || generation !== this.generation) return result;
      if (this.pending.resolve(requestId)) this.onEvent('evt.question_answered', { requestId });
      return result;
    } catch (error) {
      if (this.stopped || generation !== this.generation) throw error;
      // Once continuation started, or Host explicitly reports an unknown outcome,
      // replaying the answer could repeat a side effect. Only pre-admission failures
      // leave the original questionnaire answerable.
      if (continued || /** @type {any} */ (error)?.code === 'AGENT_OUTCOME_UNKNOWN') {
        if (this.pending.resolve(requestId)) this.resolveEvent(requestId, item, 'continuation_failed');
      } else {
        this.pending?.release(requestId, claimId);
      }
      throw error;
    }
  }

  chatIdForSession(sessionId) {
    for (const [chatId, value] of this.sessions) {
      if (value === sessionId) return chatId;
    }
    return 'unknown';
  }

  handleAgentEvent(chatId, event, controller) {
    if (this.stopped) return;
    switch (event.type) {
      case 'turn.started':
        this.aborts.set(event.turnId, controller);
        this.onEvent('evt.turn_started', { chatId, turnId: event.turnId, startedAt: Date.now() });
        break;

      case 'text.delta':
        this.onEvent('evt.message_chunk', {
          chatId,
          turnId: event.turnId,
          messageId: messageIdFor(chatId, event.turnId),
          text: event.text,
        });
        break;

      case 'message.committed':
        this.onEvent('evt.message_committed', {
          message: {
            messageId: messageIdFor(chatId, event.turnId),
            chatId,
            role: 'assistant',
            text: event.text,
            ts: Date.now(),
            // The turn this belongs to, so that the phone can group the answer with the
            // tool calls the turn made.
            turnId: event.turnId,
            authorId: authorIdFor(chatId),
          },
        });
        break;

      case 'tool.started': {
        const callId = this.startTool(event.turnId, event.name);
        this.onEvent('evt.tool_started', {
          chatId,
          turnId: event.turnId,
          toolName: event.name,
          callId,
        });
        break;
      }

      case 'tool.finished': {
        const call = this.finishTool(event.turnId, event.name);
        // The host does not report how long a tool took, so the bridge times it itself:
        // the phone shows a real duration rather than a blank.
        const measured = call === undefined ? undefined : Date.now() - call.startedAt;
        const durationMs = measured === undefined ? undefined : Math.max(0, measured);
        this.onEvent('evt.tool_finished', {
          chatId,
          turnId: event.turnId,
          toolName: event.name,
          callId: call?.callId ?? `call_${(this.callCounter += 1)}`,
          ok: event.ok === true,
          ...(durationMs === undefined ? {} : { usage: { durationMs } }),
          ...(event.error ? { error: String(event.error) } : {}),
        });
        break;
      }

      case 'permission.requested': {
        if (this.pending?.seen(event.requestId)) break;
        const request = {
          requestId: event.requestId,
          sessionId: event.sessionId,
          turnId: event.turnId,
          // The conversation that is waiting: the phone shows the request where it was
          // asked, not in a list somewhere else.
          chatId,
          toolName: event.toolName,
          toolInput: event.toolInput,
          reason: event.reason,
        };
        this.pending?.add('permission', request, event.sessionId);
        const item = this.pending?.get(event.requestId);
        if (item) this.pendingScopes.set(item, controller);
        this.onEvent('evt.permission_requested', { request });
        break;
      }

      case 'question.requested': {
        if (this.pending?.seen(event.requestId)) break;
        const request = {
          requestId: event.requestId,
          sessionId: event.sessionId,
          turnId: event.turnId,
          chatId,
          mode: event.mode,
          title: event.request.title,
          steps: event.request.steps,
          ...(typeof event.request.expiresAt === 'number' ? { expiresAt: event.request.expiresAt } : {}),
        };
        this.pending?.add('question', request, event.sessionId);
        const item = this.pending?.get(event.requestId);
        if (item) this.pendingScopes.set(item, controller);
        this.onEvent('evt.question_requested', { request });
        break;
      }

      case 'turn.finished':
        // A finished turn is no longer abortable, even while its result is arriving.
        this.aborts.delete(event.turnId);
        // A tool call that never reported back must not stay on the phone for ever.
        this.clearTools(event.turnId);
        this.onEvent('evt.turn_finished', {
          chatId,
          turnId: event.turnId,
          status: event.status,
          reason: event.status === 'error' ? 'error' : event.status === 'aborted' ? 'cancelled' : undefined,
          text: event.text,
          error: event.error,
        });
        break;

      default:
        break;
    }
  }
}

export function messageIdFor(chatId, turnId) {
  return `msg_${turnId ?? chatId}`;
}

export function authorIdFor(chatId) {
  return chatId.startsWith('bot:') ? chatId.slice(4) : undefined;
}

/**
 * Builds an error that carries the protocol's error code.
 *
 * @param {string} code
 * @param {string} message
 * @param {boolean} [retryable]
 * @returns {Error & {code: string, retryable: boolean}}
 */
function codedError(code, message, retryable = false) {
  const error = new Error(message);
  return Object.assign(error, { code, retryable });
}

/**
 * The answers in the shape the Host's agent takes.
 *
 * The Host expects every step of a questionnaire to be answered: the options that were
 * chosen, or the free-text answer, or an explicit skip. An answer in any other shape
 * is translated here, so the Host is never handed something it will refuse.
 *
 * A phone build that predates the current app sends the answer as a single value with
 * the option it chose. That shape is still understood, so a phone that has not been
 * rebuilt can still answer.
 *
 * @param {unknown} answers
 * @returns {Array<{stepId: string, selectedOptionIds: string[], selectedOther: boolean, otherText?: string, skipped?: boolean}>}
 */
function normaliseAnswers(answers) {
  if (!Array.isArray(answers)) return [];
  const normalised = [];
  for (const answer of answers) {
    const stepId = typeof answer?.stepId === 'string' ? answer.stepId : '';
    if (!stepId) continue;
    const selected = Array.isArray(answer?.selectedOptionIds)
      ? answer.selectedOptionIds.filter((id) => typeof id === 'string')
      : [];
    const legacyOption = typeof answer?.optionId === 'string' ? answer.optionId : '';
    const otherText = typeof answer?.otherText === 'string' ? answer.otherText : '';
    const legacyValue = typeof answer?.value === 'string' ? answer.value : '';
    const options = selected.length ? selected : legacyOption ? [legacyOption] : [];
    // In the older shape the value is the label of the option that was chosen, so it
    // is only a free-text answer when no option was chosen at all.
    const text = otherText || (legacyOption ? '' : legacyValue);
    normalised.push({
      stepId,
      selectedOptionIds: options,
      selectedOther: answer?.selectedOther === true || (!options.length && Boolean(text)),
      ...(text ? { otherText: text } : {}),
      ...(answer?.skipped === true ? { skipped: true } : {}),
    });
  }
  return normalised;
}
