/**
 * Usage and execution ledger.
 *
 * The MiniMax Bot Mini App serves usage from its own store, which a bridge cannot read.
 * The receipts the team tools return do carry token usage, so the bridge reconstructs the
 * same numbers from the calls it makes and the turns it runs.
 */

import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { writePrivateFileAtomic } from './private-file.mjs';

const LEDGER_FILE = 'ledger.json';
const MAX_ENTRIES = 5000;
/** How many dispatched batches are remembered for the task list. */
const MAX_BATCHES = 50;

export class Ledger {
  /** @param {string} dataDir @param {{maxEntries?: number, room?: string}} [options] */
  constructor(dataDir, { maxEntries = MAX_ENTRIES, room = undefined } = {}) {
    this.room = room;
    // Legacy unscoped ledgers are deliberately never adopted by a configured room.
    this.dataDir = room === undefined ? dataDir : join(dataDir, 'rooms', createHash('sha256').update(room).digest('hex'));
    /** @type {Array<{chatId?: string, taskId?: string, messageId?: string}>} */
    this.historyRefs = [];
    this.maxEntries = maxEntries;
    /** @type {Array<import('./contracts.d.ts').LedgerEntry>} */
    this.entries = [];
    /**
     * The batches the bridge has dispatched.
     *
     * The team's task tool answers for one batch at a time and has no "list
     * everything" call, so the batch ids are what make a task list possible at all.
     * They are kept across restarts for the same reason.
     *
     * @type {string[]}
     */
    this.batchIds = [];
    this.writeQueue = Promise.resolve();
  }

  async init() {
    await mkdir(this.dataDir, { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(join(this.dataDir, LEDGER_FILE), 'utf8'));
      if (this.room !== undefined && parsed.room !== this.room) return this;
      this.historyRefs = Array.isArray(parsed.historyRefs) ? parsed.historyRefs.slice(-this.maxEntries) : [];
      if (Array.isArray(parsed.entries)) {
        this.entries = parsed.entries.slice(-this.maxEntries);
      }
      if (Array.isArray(parsed.batchIds)) {
        this.batchIds = parsed.batchIds.slice(-MAX_BATCHES);
      }
    } catch {
      this.entries = [];
      this.batchIds = [];
    }
    return this;
  }

  persist() {
    const contents = `${JSON.stringify({ entries: this.entries, batchIds: this.batchIds,
      ...(this.room === undefined ? {} : { room: this.room, historyRefs: this.historyRefs }),
    }, null, 2)}\n`;
    const write = this.writeQueue.then(async () => {
      await mkdir(this.dataDir, { recursive: true });
      await writePrivateFileAtomic(join(this.dataDir, LEDGER_FILE), contents);
    });
    // A failed write belongs to its caller, not to every later admitted record.
    this.writeQueue = write.then(() => {}, () => {});
    return write;
  }

  /** Keep references, not copies of the Desktop product's transcript. */
  rememberTurn({ chatId = undefined, taskId = undefined, messageId = undefined } = {}) {
    if (!taskId && !messageId) return;
    if (this.historyRefs.some(ref => ref.chatId === chatId && ref.taskId === taskId && ref.messageId === messageId)) return;
    this.historyRefs.push({ chatId, taskId, messageId });
    if (this.historyRefs.length > this.maxEntries) this.historyRefs.splice(0, this.historyRefs.length - this.maxEntries);
  }

  /** Remembers a dispatched batch, so its tasks can be read back later. */
  rememberBatch(batchId) {
    if (!batchId || this.batchIds.includes(batchId)) return;
    this.batchIds.push(batchId);
    if (this.batchIds.length > MAX_BATCHES) {
      this.batchIds = this.batchIds.slice(-MAX_BATCHES);
    }
  }

  /** The remembered batch ids, oldest first. */
  batches() {
    return [...this.batchIds];
  }

  /** Records a completed turn. */
  recordTurn({ botId, botName, chars = 0, durationMs = 0, error = false, tokens = undefined, cost = undefined }) {
    this.push({
      ts: Date.now(),
      kind: 'turn',
      botId,
      botName,
      chars,
      durationMs,
      error,
      ...(typeof tokens === 'number' && Number.isFinite(tokens) && tokens >= 0 ? { tokens } : {}),
      ...(typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? { cost } : {}),
    });
  }

  /** Records a completed tool call. */
  recordTool({ botId, toolName, ok = true, durationMs = 0, tokens = 0, error = false }) {
    this.push({
      ts: Date.now(),
      kind: 'tool',
      botId,
      toolName,
      ok,
      tokens,
      durationMs,
      error,
    });
  }

  /**
   * Records a permission decision.
   *
   * A decision is not a tool call and it is not usage: it is a record of what
   * was allowed, by which phone, and when. It is kept so that the answer can be
   * attributed later.
   */
  recordPermission({ requestId, toolName, deviceId, decision }) {
    this.push({
      ts: Date.now(),
      kind: 'permission',
      requestId,
      toolName,
      deviceId,
      decision,
    });
  }

  /**
   * Records a change to who may reach the relay.
   *
   * A revoked phone and a rotated bridge token are the two moments when the set
   * of people who can drive the desktop changes. A record of what was allowed is
   * only worth something if the changes are in it too.
   */
  recordAccessChange({ action, subject, detail }) {
    this.push({
      ts: Date.now(),
      kind: 'access',
      action,
      subject,
      detail,
    });
  }

  push(entry) {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }

  /**
   * Builds a usage report.
   *
   * A span of one day or less is bucketed by hour, anything longer by day, matching how
   * the MiniMax Bot usage panel reads.
   */
  report({ days = 7, botNames = {} } = {}) {
    const hourly = days <= 1;
    // Hourly mode always spans a full day; day mode spans the requested window.
    const span = hourly ? 24 : Math.max(1, Math.min(90, days));
    const now = new Date();
    const start = new Date(now);
    if (hourly) {
      start.setMinutes(0, 0, 0);
      start.setHours(start.getHours() - 23);
    } else {
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - (span - 1));
    }
    const startMs = start.getTime();

    const buckets = new Map();
    for (let i = 0; i < span; i += 1) {
      const cursor = new Date(start);
      if (hourly) cursor.setHours(start.getHours() + i);
      else cursor.setDate(start.getDate() + i);
      const key = bucketKey(cursor, hourly);
      buckets.set(key, {
        key,
        label: hourly ? `${String(cursor.getHours()).padStart(2, '0')}:00` : `${cursor.getMonth() + 1}/${cursor.getDate()}`,
        turns: 0,
        chars: 0,
        tools: 0,
        durationMs: 0,
        errors: 0,
      });
    }

    const byBot = new Map();
    const totals = { turns: 0, chars: 0, tools: 0, durationMs: 0, errors: 0 };

    for (const entry of this.entries) {
      if (entry.ts < startMs) continue;
      // A decision and an access change are records, not usage. They say what
      // was allowed and by whom, and counting them as tool calls would put them
      // into the usage totals and into a bot that is not there.
      if (entry.kind !== 'turn' && entry.kind !== 'tool') continue;
      const bucket = buckets.get(bucketKey(new Date(entry.ts), hourly));
      if (!bucket) continue;

      const botId = entry.botId ?? 'unknown';
      const bot = byBot.get(botId) ?? {
        botId,
        name: entry.botName ?? botNames[botId] ?? botId,
        turns: 0,
        chars: 0,
        tools: 0,
      };

      if (entry.kind === 'turn') {
        bucket.turns += 1;
        bucket.chars += entry.chars ?? 0;
        bucket.durationMs += entry.durationMs ?? 0;
        totals.turns += 1;
        totals.chars += entry.chars ?? 0;
        totals.durationMs += entry.durationMs ?? 0;
        bot.turns += 1;
        bot.chars += entry.chars ?? 0;
      } else {
        bucket.tools += 1;
        totals.tools += 1;
        bot.tools += 1;
      }

      if (entry.error) {
        bucket.errors += 1;
        totals.errors += 1;
      }

      byBot.set(botId, bot);
    }

    return {
      buckets: [...buckets.values()],
      byBot: [...byBot.values()].sort((a, b) => b.turns - a.turns),
      totals,
    };
  }

  /** The most recent calls, newest first. Drives the execution-records view. */
  recent(limit = 50) {
    return this.entries.slice(-limit).reverse();
  }
}

function bucketKey(date, hourly) {
  const pad = (value) => String(value).padStart(2, '0');
  if (hourly) {
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:00`;
  }
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
