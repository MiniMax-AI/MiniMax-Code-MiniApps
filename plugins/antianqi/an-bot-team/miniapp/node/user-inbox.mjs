// @ts-check
import { t } from './i18n.mjs';

const MAX_BATCH_CHARS = 60000;
const MAX_BATCH_MESSAGES = 20;
const HELD_STATES = new Set(['held', 'adjusting']);

/** Serial user rounds per chat. New messages join a pending batch until execution is claimed. */
export class UserInbox {
  constructor(engine, ErrorType) {
    this.engine = engine;
    this.ErrorType = ErrorType;
    this.batches = new Set();
    this.actions = new Map();
  }

  has(messageId) {
    return [...this.batches].some((batch) => batch.messages.some((message) => message.id === messageId));
  }

  busy(chatId) {
    return [...this.batches].some((batch) => batch.chatId === chatId && !batch.cancelled);
  }

  async setDeliveryState(batch, state) {
    // Use one atomic write: a crash cannot split a batch into delivered and replayable inputs.
    const messages = await this.engine.store.updateMessages(batch.chatId, batch.messages.map((m) => m.id), { dispatchState: state });
    for (const message of messages) this.engine.broadcast({ type: 'message.upsert', chatId: batch.chatId, message });
  }

  enqueue(chatId, message, bot, group) {
    const queued = [...this.batches].filter((batch) => batch.chatId === chatId && !batch.started && !batch.cancelled);
    // Append only to the tail so a smaller message cannot overtake an overflow batch.
    // Supplements arriving during cancellation join this same continuation.
    const pending = queued.at(-1);
    if (pending && !pending.settling && pending.messages.length < MAX_BATCH_MESSAGES && pending.chars + message.text.length <= MAX_BATCH_CHARS) {
      pending.messages.push(message);
      pending.messages.sort((a, b) => a.seq - b.seq);
      pending.chars += message.text.length;
      this.adjustForInput(queued[0]);
      return;
    }
    const batch = { chatId, messages: [message], chars: message.text.length, bot, group, started: false, cancelled: false };
    this.batches.add(batch);
    this.adjustForInput(queued[0] ?? batch);
    this.engine.emitBusy(chatId);
    batch.done = this.engine.serial(`user:${chatId}`, async () => {
      try {
        // Also wait for work not launched by the inbox (a helper report, retry or schedule).
        const turns = [...this.engine.tickets].filter((ticket) => ticket.chatId === chatId);
        const settled = await Promise.all(turns.map((ticket) => ticket.done));
        if (batch.cancelled || this.engine.disposed) return { safeToContinue: true, accepted: false };
        for (;;) {
          const adjustment = batch.adjustment;
          if (adjustment) await adjustment;
          const history = await this.engine.store.getMessages(chatId);
          // A new input can install the gate while history is loading.
          if (adjustment !== batch.adjustment) continue;
          if (batch.cancelled || this.engine.disposed) return { safeToContinue: true, accepted: false };
          if (history.some((item) => HELD_STATES.has(item.dispatchState) || (item.dispatchState === 'uncertain' && !item.continuationAcknowledged)) || settled.some((result) => result?.safeToContinue === false)) {
            batch.settling = true;
            await this.setDeliveryState(batch, 'held');
            return;
          }
          batch.started = true;
          break;
        }
        await this.setDeliveryState(batch, 'processing');
        if (batch.cancelled || this.engine.disposed) {
          await this.setDeliveryState(batch, 'cancelled');
          return { safeToContinue: true, accepted: false };
        }
        const result = await this.engine.runUserBatch(batch);
        await this.setDeliveryState(batch, result?.errorCode === 'AGENT_OUTCOME_UNKNOWN' || (result?.safeToContinue === false && !result?.pendingQuestion)
          ? 'uncertain' : result?.skipped ? 'cancelled' : result?.accepted ? 'delivered' : 'failed');
        if (result?.safeToContinue === false || result?.pendingQuestion) {
          // Pending supplements must not silently bypass an unresolved turn or questionnaire.
          for (const next of this.batches) if (next.chatId === chatId && !next.started) await this.setDeliveryState(next, 'held');
        }
        return result;
      } catch (error) {
        batch.settling = true;
        await this.setDeliveryState(batch, batch.started
          ? ['agent_unavailable', 'not_found', 'invalid', 'busy'].includes(error?.code) ? 'failed' : 'uncertain'
          : 'held');
        await this.engine.reportFailure(chatId, error);
      } finally {
        this.batches.delete(batch);
        this.engine.emitBusy(chatId);
      }
    });
    // Storage failures are logged; a durable processing/adjusting marker survives a restart.
    void batch.done.catch((error) => this.engine.logger.warn('minimax_bot.inbox_failed', { code: error?.code ?? 'unknown' }));
  }

  /** Install one cancellation gate on the next batch, including an existing overflow batch. */
  adjustForInput(batch) {
    if (batch.adjustment || batch.settling) return;
    const { chatId } = batch;
    const active = [...this.batches].some((item) => item.chatId === chatId && item.started && !item.cancelled) ||
      [...this.engine.tickets].some((ticket) => ticket.chatId === chatId) || this.engine.groupLoops.has(chatId);
    if (!active) return;
    batch.adjustment = this.adjust(batch);
    // The serial runner observes failures after the old turn settles. Attach a handler
    // immediately so a failed persistence write never becomes an unhandled rejection.
    void batch.adjustment.catch(() => {});
  }

  /** Sending a supplement interrupts once; later supplements share its confirmation gate. */
  async adjust(batch) {
    const { chatId } = batch;
    // Persist before aborting. On restart these become held, never automatically replayed.
    await this.setDeliveryState(batch, 'adjusting');
    if (batch.cancelled || this.engine.disposed) return { ok: true };
    const active = [...this.batches].filter((item) => item.chatId === chatId && item.started && !item.cancelled && item !== batch);
    // Cover the interval before a user round creates its Host ticket as well as live turns.
    for (const current of active) current.cancelled = true;
    const targets = [...this.engine.tickets].filter((ticket) => ticket.chatId === chatId);
    const loop = this.engine.groupLoops.get(chatId);
    if (loop) loop.cancelled = true;
    for (const target of targets) target.controller.abort();
    const results = await Promise.allSettled([...targets.map((target) => target.done), ...active.map((current) => current.done)]);
    const confirmed = results.every((result) => result.status === 'fulfilled' && result.value?.safeToContinue === true);
    if (!batch.cancelled && !this.engine.disposed) {
      // If cancellation won before admission, keep that unsubmitted task as context too.
      // Inputs already accepted by the Host are never replayed.
      for (let i = 0; i < active.length; i += 1) {
        const outcome = results[targets.length + i];
        if (outcome.status === 'fulfilled' && outcome.value?.safeToContinue && outcome.value.accepted === false) {
          batch.messages.unshift(...active[i].messages);
          batch.chars += active[i].chars;
        }
      }
      batch.messages.sort((a, b) => a.seq - b.seq);
      await this.setDeliveryState(batch, confirmed ? 'pending' : 'held');
    }
    return { ok: true, held: !confirmed };
  }

  async resume(chatId) {
    const key = `resume:${chatId}`;
    if (this.actions.has(key)) return this.actions.get(key);
    const operation = this.resumeHeld(chatId);
    this.actions.set(key, operation);
    try { return await operation; }
    finally { this.actions.delete(key); }
  }

  async resumeHeld(chatId) {
    // Only resend supplements that never started; an uncertain original request is never replayed.
    const history = await this.engine.store.getMessages(chatId);
    const held = history.filter((message) => message.role === 'user' && message.dispatchState === 'held' && !this.has(message.id));
    if (!held.length || this.busy(chatId) || [...this.engine.tickets].some((ticket) => ticket.chatId === chatId)) {
      throw new this.ErrorType('busy', t('err.messageAlreadyProcessing'));
    }
    const bot = chatId.startsWith('bot:') ? this.engine.store.getBot(chatId.slice(4)) : undefined;
    const group = chatId.startsWith('group:') ? this.engine.store.getGroup(chatId.slice(6)) : undefined;
    if (!bot && !group) throw new this.ErrorType('not_found', t('err.chatMissing'));
    const uncertainIds = history.filter((message) => message.role === 'user' && message.dispatchState === 'uncertain').map((message) => message.id);
    await this.engine.store.updateMessages(chatId, uncertainIds, { continuationAcknowledged: true });
    const messages = await this.engine.store.updateMessages(chatId, held.map((message) => message.id), { dispatchState: 'pending' });
    for (const message of messages) {
      this.engine.broadcast({ type: 'message.upsert', chatId, message });
      this.enqueue(chatId, message, bot, group);
    }
    return { ok: true };
  }

  cancel(chatId, { persist = true } = {}) {
    for (const batch of this.batches) {
      if (chatId !== undefined && batch.chatId !== chatId) continue;
      batch.cancelled = true;
      if (persist && !batch.started) void this.setDeliveryState(batch, 'cancelled').catch((error) =>
        this.engine.logger.warn('minimax_bot.inbox_cancel_failed', { code: error?.code ?? 'unknown' }));
    }
  }
}
