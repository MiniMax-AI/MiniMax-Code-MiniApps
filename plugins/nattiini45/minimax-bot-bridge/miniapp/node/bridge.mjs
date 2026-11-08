/**
 * The bridge.
 *
 * Owns the team connection, runs Bot turns, answers every operation the client can ask
 * for, and publishes the result as events. The desktop is the single writer of chat
 * state; the phone is a projection of it.
 */

import { createHash } from 'node:crypto';
import { AgentRunner, authorIdFor } from './agent.mjs';
import { BotRouter } from './bot-router.mjs';
import { readCapabilities } from './capabilities.mjs';
import { saveConfig } from './config.mjs';
import { desktopBots, desktopGroups, desktopMessages, readBotPicture, readDesktopState } from './desktop-team.mjs';
import { Ledger } from './ledger.mjs';
import { PendingSet } from './pending.mjs';
import { RelayClient } from './relay-client.mjs';
import { OP_TOOL, ToolGateway } from './tools.mjs';
import {
  MAX_ACTIVITY_CALLS,
  createFrame,
  isValidClientMessageId,
  newId,
  trimTurnActivity,
  turnOrderOf,
} from './protocol/index.js';

const OP_DEDUPE_TTL_MS = 10 * 60 * 1000;
const HISTORY_LIMIT = 200;

/**
 * Where a Bot's turn runs when the phone sends it a message, unless the phone says
 * otherwise.
 *
 * `team` runs the turn in the team's own engine, where the desktop Bot app keeps the
 * whole exchange: the phone's message and the Bot's answer are both in the desktop's
 * own conversation, which is what the phone is a remote for.
 *
 * `hosted` runs the turn on the desktop under the bridge, in the Bot's own session, so
 * that a permission check or a questionnaire the Bot raises can be answered from the
 * phone — the Host only lets the Mini App that owns a run answer its questions. What
 * it costs is the transcript: the official engine does not write a turn the bridge
 * owns into the Bot's own list of messages.
 *
 * The phone can choose either, per Bot, and the choice is remembered.
 */
const DEFAULT_RUN_MODE = 'team';

/**
 * How much state a client can make the bridge hold.
 *
 * Every map below is keyed by something a client chose: a chat id, a message id, an
 * operation id. A client that keeps inventing new ones makes the desktop's memory grow
 * without bound, and the desktop is the one that pays for it. Each of these is a ceiling
 * on how many keys are kept at once; the oldest entry is dropped when the ceiling is
 * reached, so the state that survives is the state that was used most recently.
 */
const MAX_TRACKED_CHATS = 50;
const MAX_REACTION_MESSAGES = 500;
const MAX_OP_CACHE_ENTRIES = 500;

/**
 * The longest emoji a reaction may carry, in code points.
 *
 * The emoji is stored verbatim and broadcast to every device in the room, so a client
 * that sends a megabyte of text as an "emoji" would put it on every phone.
 */
const MAX_REACTION_EMOJI_LENGTH = 32;

/**
 * The first value a Bot carries under one of several names.
 *
 * The team tool is not the only writer of a Bot's record, and each one spells the
 * presentation fields differently: the octopus's look is `skin` in one place and
 * `look` in another, the colour is `color` here and `colour` there.
 *
 * @param {any} bot
 * @param {string[]} names
 * @returns {string | undefined}
 */
function firstString(bot, names) {
  for (const name of names) {
    const value = bot?.[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * Maps one Bot from the team tool's shape to the protocol's shape.
 *
 * The team tool reports `bot_id` and `main`; the protocol the phone speaks uses
 * `botId` and `isMain`. The tool also reports the model as `provider/model`, which
 * is kept as it is: a phone that shows "custom_provider:ollama-cloud/muse-spark-open"
 * is telling the truth about which model the Bot runs on.
 *
 * The Bot's look is carried too, so the phone draws the same octopus the desktop
 * draws. A picture the phone could not load — a path on the desktop, say — is left
 * out, so the app falls back to the octopus instead of a broken frame.
 *
 * @param {any} bot
 * @returns {{botId: string, name: string, role?: string, skin?: string, color?: string, avatar?: string, model?: string, instructions?: string, effort?: string, isMain: boolean}}
 */
function mapBot(bot) {
  const avatar = firstString(bot, ['avatar_url', 'avatarUrl', 'avatar', 'image_url', 'imageUrl']);
  const loadable = avatar && /^(https?:\/\/|data:image\/)/i.test(avatar) ? avatar : undefined;
  return {
    botId: String(bot?.bot_id ?? bot?.botId ?? ''),
    name: String(bot?.name ?? ''),
    role: bot?.role ? String(bot.role) : undefined,
    skin: firstString(bot, ['skin', 'look', 'skin_id', 'skinId']),
    color: firstString(bot, ['color', 'colour']),
    avatar: loadable,
    model: bot?.model ? String(bot.model) : undefined,
    // What the Bot is for, in the Bot's own words: the brief a turn runs carries it.
    instructions: bot?.instructions ? String(bot.instructions) : undefined,
    effort: bot?.effort ? String(bot.effort) : undefined,
    isMain: bot?.main === true || bot?.isMain === true,
  };
}

/**
 * Maps one group from the team tool's shape to the protocol's shape.
 *
 * The tool reports the group's members and its admin by *name*, while the protocol
 * carries ids, so the names are resolved against the roster. A name that is not in
 * the roster is kept as it is rather than dropped, so a member is never lost.
 *
 * @param {any} group
 * @param {Map<string, string>} idByName Bot name to bot id.
 */
function mapGroup(group, idByName) {
  const members = Array.isArray(group?.members)
    ? group.members
    : Array.isArray(group?.memberIds)
      ? group.memberIds
      : [];
  const adminName = group?.admin ? String(group.admin) : '';
  return {
    groupId: String(group?.group_id ?? group?.groupId ?? ''),
    name: String(group?.name ?? ''),
    notice: group?.notice ? String(group.notice) : undefined,
    admin: idByName.get(adminName) ?? adminName,
    memberIds: members.map((member) => idByName.get(String(member)) ?? String(member)),
    replyMode: group?.reply_mode === 'all' || group?.replyMode === 'all' ? 'all' : 'admin',
  };
}

/**
 * The task list, in the protocol's shape.
 *
 * The team tool answers in snake_case (`task_id`, `bot_id`, `created_at`) and calls
 * the task's status `status`; the phone reads camelCase and calls it `state`. The
 * renaming happens here rather than in the tool's own vocabulary.
 *
 * @param {any} data
 */
function normaliseTasks(data) {
  // The team's task tools answer inside a `value` envelope.
  const source =
    data && typeof data === 'object' && data.value && typeof data.value === 'object' ? data.value : data;
  if (!source || typeof source !== 'object' || !Array.isArray(source.tasks)) return source;
  const batchId = source.batch_id ?? source.batchId;
  const requestId = source.request_id ?? source.requestId;
  return {
    ...source,
    ...(batchId ? { batchId } : {}),
    ...(requestId ? { requestId } : {}),
    tasks: source.tasks.map((task) => {
      if (!task || typeof task !== 'object') return task;
      const {
        task_id: taskId,
        bot_id: botId,
        status,
        created_at: createdAt,
        started_at: startedAt,
        ended_at: endedAt,
        result_message_id: resultMessageId,
        chat_id: chatId,
        ...rest
      } = task;
      const state = status ?? rest.state;
      return {
        ...rest,
        ...(taskId !== undefined ? { taskId } : {}),
        ...(state !== undefined ? { state } : {}),
        ...(botId ? { botIds: [botId] } : {}),
        ...(createdAt !== undefined ? { createdAt } : {}),
        updatedAt: endedAt ?? startedAt ?? createdAt ?? 0,
        ...(resultMessageId ? { resultMessageId } : {}),
        ...(chatId ? { chatId } : {}),
      };
    }),
  };
}

/**
 * The helper list, in the protocol's shape.
 *
 * The team tool answers with a bare array of helpers, each with a `helper_id`, a
 * `status` and a duration in seconds. The phone reads an object with a `helpers`
 * list, so the array is wrapped and the fields are renamed.
 *
 * @param {any} data
 */
function normaliseHelpers(data) {
  const list = Array.isArray(data)
    ? data
    : Array.isArray(data?.helpers)
      ? data.helpers
      : [];
  const rest = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  return {
    ...rest,
    helpers: list.map((helper) => {
      if (!helper || typeof helper !== 'object') return helper;
      const { helper_id: helperId, status, seconds, report, error, ...fields } = helper;
      return {
        ...fields,
        ...(helperId !== undefined ? { helperId } : {}),
        ...(status ? { state: status } : {}),
        ...(seconds !== undefined ? { seconds } : {}),
        ...(report ?? error ? { detail: report ?? error } : {}),
      };
    }),
  };
}

/**
 * The schedule list, in the protocol's shape.
 *
 * The team tool answers with a bare array of schedules. Its `next_run` and
 * `last_run` are ISO timestamps and the trigger is either a `time` or an
 * `every_minutes`, while the protocol carries epoch milliseconds and one `spec`.
 *
 * @param {any} data
 */
function normaliseSchedules(data) {
  const list = Array.isArray(data)
    ? data
    : Array.isArray(data?.schedules)
      ? data.schedules
      : [];
  const rest = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  return {
    ...rest,
    schedules: list.map((schedule) => {
      if (!schedule || typeof schedule !== 'object') return schedule;
      const {
        schedule_id: scheduleId,
        bot_id: botId,
        time,
        every_minutes: everyMinutes,
        next_run: nextRun,
        last_run: lastRun,
        ...fields
      } = schedule;
      const spec = time ?? (everyMinutes === undefined ? undefined : String(everyMinutes));
      return {
        ...fields,
        ...(scheduleId !== undefined ? { scheduleId } : {}),
        ...(botId ? { targetBotId: botId } : {}),
        ...(spec !== undefined ? { spec } : {}),
        ...(nextRun ? { nextRunAt: toEpoch(nextRun) } : {}),
        ...(lastRun ? { lastRunAt: toEpoch(lastRun) } : {}),
      };
    }),
  };
}

/**
 * Normalises a tool's answer into the protocol's shape.
 *
 * Each tool answers in its own way: the task tools answer with an object, the
 * helper and schedule tools with a bare array. The phone only ever sees one shape.
 *
 * @param {string} toolName
 * @param {any} data
 */
function normaliseResult(toolName, data) {
  switch (toolName) {
    case 'dispatch_tasks':
    case 'get_tasks':
    case 'cancel_tasks':
      return normaliseTasks(data);
    case 'list_helpers':
      return normaliseHelpers(data);
    case 'list_schedules':
      return normaliseSchedules(data);
    default:
      return data;
  }
}

/**
 * An ISO timestamp as epoch milliseconds, or the value itself when it already is one.
 *
 * @param {unknown} value
 */
function toEpoch(value) {
  if (typeof value === 'number') return value;
  const parsed = Date.parse(String(value ?? ''));
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * A topic key for a memory the client did not file under one.
 *
 * The team's memory tool insists on a topic: a memory is either filed under a topic
 * or replaces an existing entry. The key has to match the tool's own pattern — a
 * lowercase word, then lowercase letters, digits, dots, dashes and underscores — and
 * it has to be unique, because writing the same topic twice without the entry's
 * revision is a conflict.
 */
function generateTopicKey() {
  return `phone.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`;
}

/** How many batches the bridge asks about when it rebuilds the task list. */
const MAX_BATCHES = 20;

/** How often the team snapshot is retried while the Host prepares the generation. */
const SNAPSHOT_RETRIES = 12;
/** The gap between two snapshot attempts. */
const SNAPSHOT_RETRY_MS = 1500;

/**
 * What the room is told when the team roster cannot be read.
 *
 * A fixed sentence, because this travels to every phone in the room and the Host's own
 * error text can name internal paths, tool identifiers and host-side detail. The
 * detail is logged on the desktop and kept for the surface.
 */
const TEAM_ROSTER_UNREADABLE =
  'The team roster could not be read. Open MiniMax Bot on this desktop to try again.';

export class Bridge {
  /**
   * @param {any} context The Mini App context the Host supplies.
   * @param {{config?: import('./config.mjs').BridgeConfig, logger?: import('./relay-client.mjs').RelayLogger}} [options]
   */
  constructor(context, { config, logger } = {}) {
    this.context = context;
    this.config = config;
    this.configEpoch = 0;
    this.configCommit = Promise.resolve();
    this.stopped = false;
    this.lifecycleEpoch = 0;
    this.logger = logger ?? context.logger;
    this.tools = new ToolGateway(context);
    /** Active operations retain their room ledger; idle rooms need not stay in memory. @type {Map<string, WeakRef<Ledger>>} */
    this.roomLedgers = new Map();
    this.installRoom(config);
    this.relay = new RelayClient({
      url: config?.relayUrl,
      accountId: config?.accountId,
      bridgeId: config?.bridgeId,
      token: config?.bridgeToken,
      name: config?.bridgeName,
      logger: this.logger,
      onFrame: (frame) => {
        this.handleFrame(frame).catch((error) => {
          this.logger.error(`frame handling failed: ${error instanceof Error ? error.message : error}`);
        });
      },
      onStatus: (online) => {
        this.emit('evt.bridge_status', {
          desktopOnline: true,
          agentAvailable: this.runner.available,
          teamToolsAvailable: this.tools.available,
          linkedAt: this.linkedAt,
          // The live catalogue travels with the status, so a client can show which
          // team tools this desktop can reach without a second round trip.
          tools: this.tools.catalog,
        });
        if (online) this.replayPending();
      },
    });

    /** @type {Map<string, Array<import('./contracts.d.ts').ChatMessage>>} chatId -> messages */
    this.history = new Map();
    /** @type {Map<string, Array<import('./contracts.d.ts').TurnActivity>>} chatId -> the tool calls the bridge's own turns made */
    this.activity = new Map();
    /** @type {Map<string, Map<string, number>>} messageId -> emoji -> count */
    this.reactions = new Map();
    /** @type {Map<string, {promise: Promise<{ok: boolean, value?: unknown, error?: unknown}>, expiresAt: number}>} */
    this.opCache = new Map();
    /** @type {string | undefined} */
    this.snapshotError = undefined;
    /**
     * The detail behind the sentence the room was told.
     *
     * @type {string | undefined}
     */
    this.snapshotErrorDetail = undefined;
    /** @type {number} */
    this.snapshotAttempts = 0;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    this.snapshotTimer = undefined;
    this.linkedAt = Date.now();
    /**
     * Called with a fresh token after a rotation, so the host can persist it.
     *
     * @type {((token: string) => Promise<void> | void) | null}
     */
    this.onToken = null;
  }

  /** Canonical destination/subject identity, shared with the socket client. */
  roomIdentity(config = this.config) {
    return RelayClient.prototype.identity({ url: config?.relayUrl, accountId: config?.accountId, bridgeId: config?.bridgeId });
  }

  /** Replace all authority-owned runtime state without cancelling official tasks. */
  installRoom(config, ledger = new Ledger(this.context.dataDir, { room: this.roomIdentity(config) })) {
    if (this.runner) {
      this.runner.stop();
      this.lifecycleEpoch += 1;
    }
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    this.snapshotTimer = undefined;
    this.snapshotAttempts = 0;
    this.snapshotError = undefined;
    this.snapshotErrorDetail = undefined;
    const scope = { key: this.roomIdentity(config), filtered: Boolean(config?.relayUrl) };
    this.roomScope = scope;
    this.ledger = ledger;
    // A late operation and a newly active generation of the same room must share
    // one write queue and live record set. Weak values avoid retaining idle history.
    this.roomLedgers.set(scope.key, new WeakRef(ledger));
    for (const [key, reference] of this.roomLedgers) {
      if (!reference.deref()) this.roomLedgers.delete(key);
    }
    this.pending = new PendingSet();
    this.router = new BotRouter(this.context, { gateway: this.tools, roster: async () => this.readTeam() });
    const current = () => this.roomScope === scope && !this.stopped;
    this.runner = new AgentRunner(this.context, {
      pending: this.pending, router: this.router,
      onEvent: (type, payload, mode) => { if (current()) this.handleEvent(type, payload, mode); },
      onTurnFinished: info => { if (current()) return this.onTurnFinished(info); },
      onTeamAccepted: turn => {
        if (!current()) return;
        ledger.rememberBatch(turn.batchId);
        ledger.rememberTurn({ chatId: turn.chatId, taskId: turn.taskId });
        void this.persistLedger('the accepted team batch', ledger);
      },
    });
    this.runner.stopped = this.stopped;
    this.history = new Map();
    this.activity = new Map();
    this.reactions = new Map();
    this.opCache = new Map();
    this.linkedAt = Date.now();
  }

  assertScope(epoch) {
    if (this.stopped || epoch !== this.lifecycleEpoch) throw codedError('SCOPE_CHANGED', 'The bridge room changed while this operation was running.');
  }

  async start() {
    this.stopped = false;
    this.runner.stopped = false;
    const epoch = ++this.lifecycleEpoch;
    await this.ledger.init();
    if (this.stopped || epoch !== this.lifecycleEpoch) return;
    await this.tools.refresh();
    if (this.stopped || epoch !== this.lifecycleEpoch) return;
    // A token that is about to run out is replaced before it does, so a short
    // lifetime does not quietly take the desktop offline.
    await this.rotateTokenIfExpiring();
    if (this.stopped || epoch !== this.lifecycleEpoch) return;
    this.relay.start();
    this.logger.info('bridge started', {
      bridgeId: this.config?.bridgeId,
      teamTools: this.tools.catalog.length,
      agent: this.runner.available,
    });
  }

  stop() {
    this.stopped = true;
    this.lifecycleEpoch += 1;
    this.runner.stop();
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    this.snapshotTimer = undefined;
    this.relay.stop();
  }

  /**
   * All configuration writers share one persistence + memory commit. Updates are
   * derived inside the queue, never from a snapshot taken before another write.
   *
   * @param {(current: import('./config.mjs').BridgeConfig) => import('./config.mjs').BridgeConfig} update
   * @param {{reconfigure?: boolean, validate?: () => void}} [options]
   */
  commitConfig(update, { reconfigure = false, validate = () => {} } = {}) {
    const commit = this.configCommit.then(async () => {
      validate();
      const current = this.config;
      let next = update(current);
      const roomChanged = this.roomIdentity(next) !== this.roomIdentity(current);
      const tokenChanged = next.bridgeToken !== current?.bridgeToken;
      let destination;
      if (roomChanged) {
        const key = this.roomIdentity(next);
        destination = this.roomLedgers.get(key)?.deref() ?? await new Ledger(this.context.dataDir, { room: key }).init();
      }
      if (this.context?.dataDir) {
        await saveConfig(this.context.dataDir, next);
        try {
          validate();
        } catch (error) {
          // stop/start can invalidate a rotation while the file write is pending.
          // No other config writer can enter until the previous state is restored.
          await saveConfig(this.context.dataDir, current);
          throw error;
        }
      }
      this.config = next;
      if (roomChanged) this.installRoom(next, destination);
      if (roomChanged || tokenChanged) this.configEpoch += 1;
      if (roomChanged || (reconfigure && tokenChanged)) {
        const settings = {
          url: next.relayUrl, accountId: next.accountId, bridgeId: next.bridgeId,
          token: next.bridgeToken, name: next.bridgeName,
        };
        if (this.stopped) {
          this.relay.stop();
          if (roomChanged) this.relay.queue = [];
          Object.assign(this.relay, settings);
        } else {
          this.relay.reconfigure(settings);
        }
      } else {
        // A cosmetic/no-op save must not revoke the proof of an in-flight token
        // rotation. Name metadata is used on the next handshake, not broadcast.
        this.relay.url = next.relayUrl;
        this.relay.accountId = next.accountId;
        this.relay.bridgeId = next.bridgeId;
        this.relay.token = next.bridgeToken;
        this.relay.name = next.bridgeName;
      }
      return next;
    });
    // A failed write or stale rotation must not poison subsequent configuration.
    this.configCommit = commit.then(() => {}, () => {});
    return commit;
  }

  // -- outbound ------------------------------------------------------------

  emit(type, payload) {
    if (this.stopped) return;
    this.relay.send(createFrame({ type, payload, source: 'bridge' }));
  }

  /**
   * Sends an event to the phones and keeps the conversation it belongs to.
   *
   * The team's replies are part of the thread. A phone that opens a chat later, or a
   * second phone that joins, must see them — not only the messages that phone sent
   * itself.
   */
  handleEvent(type, payload, mode) {
    if (this.stopped) return;
    // The tool calls of a turn the bridge runs itself are kept, so that a phone which
    // opens the chat later sees the work the turn did and not only its answer. A turn
    // the team runs is in the desktop's own transcript, and that record is read back
    // from there instead.
    if (type === 'evt.tool_started' || type === 'evt.tool_finished') {
      this.rememberToolCall(type, payload, mode);
      if (type === 'evt.tool_finished' && mode === 'hosted') {
        this.ledger.recordTool({ botId: authorIdFor(payload.chatId), toolName: payload.toolName,
          ok: payload.ok === true, error: payload.ok !== true,
          durationMs: payload.usage?.durationMs ?? 0 });
        void this.persistLedger('a hosted tool outcome');
      }
    }
    if (type === 'evt.turn_finished') {
      const list = this.activity.get(payload?.chatId);
      if (list) {
        // A missing tool finish is unknown, not still running after its turn ended.
        for (const entry of list) {
          if (entry.turnId === payload.turnId && entry.status === 'running') entry.status = 'unknown';
        }
        this.trimStoredActivity(payload.chatId);
      }
    }
    if (type === 'evt.message_committed') {
      const message = payload?.message;
      if (message && message.role === 'assistant' && message.chatId) {
        // The phone draws the face of whoever answered, so the sender has to travel
        // with the message. The desktop's own messages name their sender; the bridge's
        // own turns already carry an author.
        const author = firstString(message, ['authorId', 'author_id', 'bot_id', 'botId', 'sender_id', 'senderId']);
        const normalised = author && !message.authorId ? { ...message, authorId: author } : message;
        // A turn the team runs is in the desktop's own transcript already; only a turn
        // the bridge runs itself is kept here, so the phone never shows it twice.
        if ((mode ?? this.runModeFor(normalised.chatId)) === 'hosted') {
          this.pushHistory(normalised.chatId, normalised);
        }
        this.emit(type, { ...payload, message: normalised });
        return;
      }
      if (message && message.role === 'system' && message.chatId) {
        // The bridge's own words about the run: the team stopped for a reason the phone
        // has to know about, or the group paused. The desktop does not keep them —
        // they were never in its transcript — so the bridge keeps them, or a phone
        // that opens the chat later finds a Bot that asked a question and no hint of
        // where the answer goes.
        this.pushHistory(message.chatId, message);
        this.emit(type, payload);
        return;
      }
    }
    this.emit(type, payload);
  }

  /**
   * Re-emits held approvals and questions so a resuming phone sees them.
   *
   * The team snapshot goes out with it: a phone that (re)connects has no roster of its
   * own, and this is the one event that carries the whole team.
   */
  replayPending() {
    // A request that is being answered right now is not waiting for an answer, so it
    // is not re-emitted: a phone that reconnects must not be shown a request it would
    // only be allowed to refuse.
    for (const item of this.pending.listUnclaimed()) {
      if (item.kind === 'permission') {
        this.emit('evt.permission_requested', { request: item.request });
      } else {
        this.emit('evt.question_requested', { request: item.request });
      }
    }
    this.emit('evt.bridge_status', {
      desktopOnline: true,
      agentAvailable: this.runner.available,
      teamToolsAvailable: this.tools.available,
      linkedAt: this.linkedAt,
      tools: this.tools.catalog,
    });
    void this.publishTeamSnapshot();
  }

  /** Publishes the current team roster to the phones. */
  async publishTeamSnapshot() {
    if (this.stopped) return false;
    const epoch = this.lifecycleEpoch;
    try {
      const team = await this.readTeam();
      if (this.stopped || epoch !== this.lifecycleEpoch) return false;
      this.snapshotError = undefined;
      this.snapshotAttempts = 0;
      this.emit('evt.team_snapshot', {
        ...team,
        diagnostics: this.diagnostics(),
        tools: this.tools.catalog,
      });
      return true;
    } catch (error) {
      if (this.stopped || epoch !== this.lifecycleEpoch) return false;
      // The reason travels with the diagnostics, so the phone can say what is wrong
      // instead of showing an empty team with no explanation. It is a fixed sentence:
      // the detail is for the desktop, not for every phone in the room.
      this.snapshotError = TEAM_ROSTER_UNREADABLE;
      this.snapshotErrorDetail = error instanceof Error ? error.message : String(error);
      this.logger.warn('team snapshot failed', { message: this.snapshotErrorDetail });
      this.emit('evt.bridge_status', {
        desktopOnline: true,
        agentAvailable: this.runner.available,
        teamToolsAvailable: this.tools.available,
        linkedAt: this.linkedAt,
        tools: this.tools.catalog,
        diagnostics: this.diagnostics(),
      });
      this.scheduleSnapshotRetry();
      return false;
    }
  }

  /**
   * Retries the team snapshot while the Host is still preparing this generation.
   *
   * The Host activates a Mini App's MCP server and binds its tools to the current
   * generation; until that has happened a tool call is refused as unavailable. The
   * bridge therefore keeps trying for a short while instead of leaving the phone
   * with an empty team.
   */
  scheduleSnapshotRetry() {
    if (this.stopped || this.snapshotTimer) return;
    const epoch = this.lifecycleEpoch;
    this.snapshotAttempts += 1;
    if (this.snapshotAttempts > SNAPSHOT_RETRIES) return;
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = undefined;
      if (!this.stopped && epoch === this.lifecycleEpoch) void this.publishTeamSnapshot();
    }, SNAPSHOT_RETRY_MS);
    this.snapshotTimer.unref?.();
  }

  // -- inbound -------------------------------------------------------------

  async handleFrame(frame) {
    if (this.stopped) return;
    if (!frame || typeof frame.type !== 'string') return;
    if (!frame.type.startsWith('op.')) return;
    const epoch = this.lifecycleEpoch;

    const opId = frame.opId ?? frame.id;
    // An operation without an id cannot be answered, and its cache key would be the
    // same for every frame of its type - so one such frame would silence that
    // operation for the whole account, and every later frame of that type would be
    // answered with its result. It is refused instead of being run.
    if (!opId) {
      this.replyError(frame, codedError('INVALID_ARGUMENTS', 'An operation must carry an opId.'));
      return;
    }
    // The cache key includes the operation type and the sender: two different
    // operations must never share a result, and one device's operation must never
    // swallow another device's when the two operation ids happen to be the same.
    const cacheKey = `${frame.type}:${frame.from ?? ''}:${opId}`;

    const cached = this.opCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      // The in-flight promise is shared, so a duplicate that arrives while the first
      // call is still running waits for it instead of running the operation twice.
      const outcome = await cached.promise;
      if (this.stopped || epoch !== this.lifecycleEpoch) return;
      if (outcome.ok) {
        this.reply(frame, outcome.value);
      } else {
        this.replyError(frame, outcome.error);
      }
      return;
    }

    // Claim the slot before awaiting, so a concurrent duplicate cannot slip past.
    /** @type {Promise<{ok: boolean, value?: unknown, error?: unknown}>} */
    const promise = this.dispatch(frame.type, frame.payload ?? {}, frame.from).then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error }),
    );
    this.opCache.set(cacheKey, { promise, expiresAt: Date.now() + OP_DEDUPE_TTL_MS });
    this.pruneCache();

    const outcome = await promise;
    if (this.stopped || epoch !== this.lifecycleEpoch) return;
    if (outcome.ok) {
      this.reply(frame, outcome.value);
    } else {
      this.replyError(frame, outcome.error);
    }
  }

  /**
   * Writes the ledger down, without failing the caller.
   *
   * The ledger is a record of what happened, not the thing that happened: a
   * decision that has been applied must not be undone by a disk that cannot be
   * written, and the caller must not be told that the work failed when it did
   * not. The entry stays in memory, so it is still there for the session.
   *
   * @param {string} what what was being recorded, for the log
   */
  async persistLedger(what, ledger = this.ledger) {
    try {
      await ledger.persist();
    } catch {
      // Never expose paths, credentials or raw filesystem errors through diagnostics.
      this.logger.warn(`The ledger could not be written; ${what} is only recorded in memory.`);
    }
  }

  /**
   * Revokes a paired phone.
   *
   * The revocation is written down with the decisions: it is a change to who may
   * reach the relay, and a record of what was allowed is only worth something if
   * the changes are in it too.
   */
  async revokeDevice(deviceId) {
    const ledger = this.ledger;
    const revoked = await this.relay.revokeDevice(deviceId);
    if (revoked) {
      ledger.recordAccessChange({
        action: 'device-revoked',
        subject: deviceId,
        detail: 'the phone cannot reach the relay any more',
      });
      await this.persistLedger('the revocation', ledger);
    }
    return revoked;
  }

  reply(frame, result) {
    if (this.stopped) return;
    this.relay.send(
      createFrame({
        type: 'ack',
        payload: { opId: frame.opId ?? frame.id, result },
        source: 'bridge',
        in_reply_to: frame.id,
      }),
    );
  }

  replyError(frame, error) {
    if (this.stopped) return;
    const code = typeof error?.code === 'string' ? error.code : 'INTERNAL';
    const retryable = code === 'BUSY' || code === 'AGENT_UNAVAILABLE' || code === 'TOOL_NOT_AVAILABLE';
    this.relay.send(
      createFrame({
        type: 'err',
        payload: {
          opId: frame.opId ?? frame.id,
          code,
          message: error instanceof Error ? error.message : String(error),
          retryable,
          // `INVALID_ARGUMENTS` carries the tool's live schema and the properties that
          // are missing, so the client can ask for the exact field instead of guessing.
          ...(error && error.details ? { details: error.details } : {}),
        },
        source: 'bridge',
        in_reply_to: frame.id,
      }),
    );
  }

  pruneCache() {
    const now = Date.now();
    for (const [key, entry] of this.opCache) {
      if (entry.expiresAt <= now) this.opCache.delete(key);
    }
    // The cache key is built from an operation id the client chose, so the time to live
    // alone does not bound it: a client that sends a hundred thousand distinct
    // operations inside one window keeps a hundred thousand entries. The oldest goes
    // first, and an operation that is repeated after it was dropped is simply run again.
    while (this.opCache.size > MAX_OP_CACHE_ENTRIES) {
      const oldest = this.opCache.keys().next();
      if (oldest.done) break;
      this.opCache.delete(oldest.value);
    }
  }

  // -- dispatch ------------------------------------------------------------

  /**
   * Runs one operation.
   *
   * @param {string} [from] the phone the relay says sent it, when it knows
   */
  async dispatch(type, payload, from) {
    this.runner.assertRunning();
    const epoch = this.lifecycleEpoch;
    const ledger = this.ledger;
    switch (type) {
      case 'op.send_message':
        return this.sendMessage(payload);
      case 'op.abort_turn':
        return { aborted: await this.runner.abort(payload.turnId) };
      case 'op.respond_permission': {
        // The request is read before the reply: answering it takes it off the
        // pending set, and the record needs the tool it was about.
        const request = this.pending.get(payload.requestId);
        await this.runner.reply(payload.requestId, payload.decision);
        // The decision is a record of what was allowed and by whom, so it is
        // written down: the request, the tool it was about, the phone that
        // answered and the answer itself.
        ledger.recordPermission({
          requestId: payload.requestId,
          toolName: request?.request?.toolName ?? 'unknown',
          deviceId: from ?? 'unknown',
          decision: payload.decision,
        });
        // The decision has already been applied - the Host has allowed or
        // refused the tool call - so a ledger that cannot be written must not
        // make the phone think the decision failed. The phone would be told
        // "failed" while the tool ran, which is worse than a missing record.
        await this.persistLedger('the permission decision', ledger);
        return { requestId: payload.requestId, decision: payload.decision };
      }
      case 'op.answer_question':
        await this.runner.answer(payload.requestId, payload.answers ?? []);
        return { requestId: payload.requestId };
      case 'op.list_history': {
        const history = await this.historyFor(payload.chatId);
        this.assertScope(epoch);
        return {
          messages: history.messages,
          activity: history.activity,
          reactions: await this.reactionsFor(payload.chatId),
        };
      }
      case 'op.get_usage':
        return this.ledger.report({ days: payload.days ?? 7 });
      case 'op.react':
        return this.react(payload);
      case 'op.set_bot_mode':
        return this.setBotMode(payload, epoch);
      case 'op.list_models':
        // The Host's own catalog: the models that can run and the efforts each of
        // them has. The phone offers this list instead of a free text field.
        return this.router.models.describe();
      case 'op.list_capabilities':
        // The skills, plugins and agents the desktop has, read from its own
        // installation.
        return readCapabilities(this.context);
      case 'op.list_team': {
        await this.tools.refresh();
        this.assertScope(epoch);
        try {
          const team = await this.readTeam();
          return { ...team, diagnostics: this.diagnostics() };
        } catch (error) {
          this.assertScope(epoch);
          // Intentional tool and validation failures remain actionable. Unexpected
          // Host exceptions are desktop diagnostics, not room-wide error text.
          if (error?.code === 'TOOL_REPORTED_ERROR' || error?.code === 'INVALID_ARGUMENTS') throw error;
          this.snapshotError = TEAM_ROSTER_UNREADABLE;
          this.snapshotErrorDetail = error instanceof Error ? error.message : String(error);
          this.logger.warn('the requested team roster could not be read', { message: this.snapshotErrorDetail });
          throw codedError('TEAM_ROSTER_UNREADABLE', TEAM_ROSTER_UNREADABLE);
        }
      }
      case 'op.bot_avatar': {
        const botId = String(payload.botId ?? '');
        if (!botId) throw codedError('INVALID_ARGUMENTS', 'botId is required.');
        const picture = await this.readBotPicture(botId);
        if (!picture) {
          throw codedError('NOT_FOUND', 'This Bot has no picture on the desktop.');
        }
        return {
          botId,
          mime: picture.mime,
          data: picture.buffer.toString('base64'),
          source: picture.source,
        };
      }
      case 'op.list_tasks': {
        // The team's task tool answers for one batch or one task at a time — there is
        // no "list everything" call. A client that names one gets that one; a client
        // that names neither gets every batch the bridge has seen.
        if (payload.taskId || payload.batchId) return this.callTool('get_tasks', payload);
        return this.listKnownTasks();
      }
      case 'op.remember': {
        // A memory is filed under a topic or replaces an entry; the team refuses one
        // with neither. A note the phone asks to remember gets its own topic.
        const request = { ...payload };
        if (!request.key && !request.replaceId) request.key = generateTopicKey();
        const result = await this.callTool('remember', request);
        return { ...result, key: request.key ?? result.key };
      }
      default: {
        const toolName = OP_TOOL[type];
        if (!toolName) {
          throw codedError('UNKNOWN_OP', `No handler for ${type}`);
        }
        const result = await this.callTool(toolName, payload);
        if (!this.stopped && epoch === this.lifecycleEpoch) await this.publishMutation(type, result);
        return result;
      }
    }
  }

  /**
   * Publishes the event that carries a mutation's result to the phones.
   *
   * The phone never polls for these: it renders what the bridge tells it. A mutation
   * that is not published leaves the phone's list stale until the next full refresh.
   */
  async publishMutation(type, result) {
    const data = result?.data && typeof result.data === 'object' ? result.data : {};
    switch (type) {
      case 'op.create_bot':
      case 'op.update_bot':
      case 'op.delete_bot':
      case 'op.create_group':
      case 'op.update_group':
      case 'op.delete_group':
        await this.publishTeamSnapshot();
        return;
      case 'op.dispatch':
      case 'op.cancel_task':
        this.emit('evt.task_updated', { task: data.task ?? data });
        return;
      case 'op.start_helper':
      case 'op.stop_helper':
        this.emit('evt.helper_updated', { helper: data.helper ?? data });
        return;
      case 'op.create_schedule':
      case 'op.delete_schedule':
        this.emit('evt.schedule_updated', { schedule: data.schedule ?? data });
        return;
      default:
        return;
    }
  }

  /**
   * The shared Desktop dispatcher has no relay-room component in its cache key.
   * @param {string | undefined} value
   */
  teamRequestId(value) {
    if (!this.roomScope.filtered || typeof value !== 'string' || !value.trim()) return value;
    return `room-${createHash('sha256').update(JSON.stringify([this.roomScope.key, value.trim()])).digest('hex')}`;
  }

  /**
   * Calls a team tool and normalises the result.
   *
   * The tool envelope differs per tool, so the raw result is returned alongside a best
   * effort structured view; the client renders the structured view and falls back to the
   * raw content when it cannot. The tool's own fields are also spread at the top level,
   * so the protocol's declared result shapes (`entries`, `tasks`, `bots`, …) are present
   * exactly where the client reads them.
   */
  async callTool(toolName, payload) {
    const ledger = this.ledger;
    if (toolName === 'dispatch_tasks' && this.roomScope.filtered) {
      const requestId = firstString(payload, ['requestId', 'request_id', 'id']);
      if (requestId) payload = { ...payload, requestId: this.teamRequestId(requestId) };
    }
    const startedAt = Date.now();
    const result = await this.tools.call(toolName, payload);
    ledger.recordTool({
      botId: payload.botId ?? payload.targetBotId ?? 'unknown',
      toolName,
      ok: result.ok === true && result.isError !== true,
      durationMs: Date.now() - startedAt,
      tokens: extractTokens(result),
      error: result.ok === true && result.isError !== true ? undefined : true,
    });

    if (!result.ok) {
      throw codedError(
        result.code ?? 'TOOL_FAILED',
        result.message ?? `The ${toolName} tool did not complete.`,
        false,
        result.details,
      );
    }
    if (result.isError === true) {
      // The tool ran and failed; its own wording is kept, because that is what tells
      // the user what went wrong.
      throw codedError(
        'TOOL_REPORTED_ERROR',
        result.message ?? `The ${toolName} tool reported an error.`,
        false,
        { tool: toolName },
      );
    }

    const data = extractData(result);
    const normalised = normaliseResult(toolName, data);
    // A batch the team reported is remembered, so the task list can be rebuilt later.
    const batchId = normalised?.batchId ?? normalised?.batch_id;
    if (batchId) ledger.rememberBatch(String(batchId));
    if (Array.isArray(normalised?.tasks)) for (const task of normalised.tasks) {
      ledger.rememberTurn({ taskId: task?.taskId ?? task?.task_id });
    }
    await this.persistLedger('the tool outcome', ledger);

    return {
      tool: toolName,
      content: result.content,
      structuredContent: result.structuredContent,
      data: normalised,
      ...(normalised && typeof normalised === 'object' && !Array.isArray(normalised) ? normalised : {}),
    };
  }

  /**
   * Rebuilds the task list from the batches the bridge knows.
   *
   * The team's task tool answers for one batch at a time, so a list is assembled by
   * asking about each batch in turn. The list is therefore never complete: a task
   * the team dispatched without the bridge is invisible to the phone, and the answer
   * says so.
   */
  async listKnownTasks() {
    const epoch = this.lifecycleEpoch;
    const batches = this.ledger.batches();
    if (batches.length === 0) {
      return {
        tasks: [],
        batchIds: [],
        partial: true,
        note: 'The team tool answers for one batch at a time, so the list only covers the work the bridge dispatched.',
      };
    }

    /** @type {any[]} */
    const tasks = [];
    const seen = new Set();
    for (const batchId of batches.slice(-MAX_BATCHES)) {
      this.assertScope(epoch);
      try {
        const result = await this.callTool('get_tasks', { batchId });
        for (const task of result.tasks ?? []) {
          const id = task?.taskId ?? task?.task_id;
          if (id && seen.has(id)) continue;
          if (id) seen.add(id);
          tasks.push(task);
        }
      } catch (error) {
        // One batch the team no longer knows must not hide the others.
        this.logger.warn('batch query failed', {
          batchId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      tasks,
      batchIds: batches,
      partial: true,
      note: 'The team tool answers for one batch at a time, so the list only covers the work the bridge dispatched.',
    };
  }

  /**
   * Reads the team roster, preferring the tool's structured output.
   *
   * The team tool reports the roster in its own shape; the mapping into the
   * protocol's shape happens here, so the phone only ever sees one shape.
   *
   * The tool answers with a summary — an id, a name, a role, a model. What a Bot
   * *looks* like is not in that summary, so the desktop's own record of the team is
   * read as well and the two are merged: the phone shows the Bot the desktop shows,
   * not a list of names.
   */
  async readTeam() {
    const result = await this.tools.call('list_team', {});
    if (!result.ok) throw codedError(result.code ?? 'TOOL_FAILED', result.message ?? 'The team roster could not be read.');
    const raw = extractData(result);
    const data = raw?.value ?? raw;
    if (result.isError === true || data?.ok === false) {
      // Intentional tool errors are actionable. Unexpected infrastructure exceptions
      // still pass through op.list_team's existing fixed-message redaction.
      throw codedError('TOOL_REPORTED_ERROR', result.message ??
        (typeof data?.error === 'string' ? data.error : 'The team roster could not be read.'));
    }
    if (!data || !Array.isArray(data.bots) || !Array.isArray(data.groups) ||
        data.bots.some(bot => !bot || typeof bot !== 'object' || Array.isArray(bot)) ||
        data.groups.some(group => !group || typeof group !== 'object' || Array.isArray(group))) {
      throw codedError('INVALID_TOOL_RESULT', 'The team roster returned an unsupported result.');
    }
    const bots = data.bots.map(mapBot);
    const idByName = new Map(bots.map((bot) => [bot.name, bot.botId]));
    const groups = Array.isArray(data.groups) ? data.groups.map((group) => mapGroup(group, idByName)) : [];
    return { bots: await this.withDesktopTeam(bots), groups: await this.withDesktopGroups(groups) };
  }

  /**
   * The team's Bots, with what the desktop knows about how they look.
   *
   * A Bot the desktop does not know about keeps the summary's fields: the tool's
   * answer is still true, it is only less complete.
   */
  async withDesktopTeam(bots) {
    // Where a turn runs is the bridge's own setting, so it is carried on the Bot the
    // phone reads: the settings screen shows the mode the desktop is actually using.
    const withMode = bots.map((bot) => ({ ...bot, runMode: this.runModeFor(`bot:${bot.botId}`) }));
    const state = await readDesktopState(this.context);
    if (!state) return withMode;
    const desktop = new Map(desktopBots(state).map((bot) => [bot.botId, bot]));
    return withMode.map((bot) => {
      const known = desktop.get(bot.botId);
      if (!known) return bot;
      return {
        ...bot,
        name: known.name || bot.name,
        role: known.role ?? bot.role,
        skin: known.skin ?? bot.skin,
        color: known.color ?? bot.color,
        face: known.face ?? bot.face,
        instructions: known.instructions ?? bot.instructions,
        effort: bot.effort ?? known.effort,
        isMain: known.isMain || bot.isMain,
      };
    });
  }

  /**
   * The team's groups, with the members the desktop knows by id.
   *
   * The tool names the members, the desktop knows their ids, and a phone needs the
   * ids to open a group chat.
   */
  async withDesktopGroups(groups) {
    const state = await readDesktopState(this.context);
    if (!state) return groups;
    const desktop = new Map(desktopGroups(state).map((group) => [group.groupId, group]));
    return groups.map((group) => {
      const known = desktop.get(group.groupId);
      if (!known) return group;
      return {
        ...group,
        name: known.name || group.name,
        admin: known.admin ?? group.admin,
        memberIds: known.memberIds.length ? known.memberIds : group.memberIds,
        notice: known.notice ?? group.notice,
        replyMode: known.replyMode ?? group.replyMode,
      };
    });
  }

  /**
   * The picture a Bot shows, read from the desktop.
   *
   * The desktop keeps the only copy of the artwork, so the phone asks for it and
   * receives the bytes. A Bot with no picture of its own and no look has none, and
   * the phone draws its octopus instead.
   */
  async readBotPicture(botId) {
    const state = await readDesktopState(this.context);
    if (!state) return undefined;
    const bot = desktopBots(state).find((candidate) => candidate.botId === botId);
    if (!bot) return undefined;
    return readBotPicture(this.context, bot);
  }

  diagnostics() {
    return {
      agentAvailable: this.runner.available,
      teamToolsAvailable: this.tools.available,
      toolCount: this.tools.catalog.length,
      partial: this.tools.partial,
      linkedAt: this.linkedAt,
      // A fixed sentence, never the Host's own error text: this travels to every
      // phone in the room.
      reason: this.snapshotError ?? this.tools.reason,
    };
  }

  /**
   * The diagnostics for the desktop's own surface.
   *
   * The surface is behind the surface secret and is read by the person sitting at the
   * desktop, so it is where the detail belongs.
   */
  desktopDiagnostics() {
    return {
      ...this.diagnostics(),
      detail: this.snapshotErrorDetail ?? this.tools.detail,
    };
  }

  async sendMessage(payload) {
    const epoch = this.lifecycleEpoch;
    const runner = this.runner;
    runner.assertRunning();
    const { chatId, text, mentions } = payload;
    if (!chatId || !text) {
      throw codedError('INVALID_ARGUMENTS', 'chatId and text are required.');
    }

    // The client may choose the id so its optimistic bubble can be replaced in place
    // when this message is committed. An id the client may not choose is ignored.
    const messageId = isValidClientMessageId(payload.clientMessageId)
      ? payload.clientMessageId
      : `msg_${newId('u')}`;
    const userMessage = {
      messageId,
      chatId,
      role: 'user',
      text,
      ts: Date.now(),
      pending: false,
    };
    // Team turns already live in the authorized Desktop transcript. Keep only
    // hosted user messages here, so team history never duplicates the user's bubble.
    if (this.runModeFor(chatId) === 'hosted') {
      this.pushHistory(chatId, userMessage);
    }
    this.emit('evt.message_committed', { message: userMessage });

    // The team reads a mention as a name, so the ids the phone sends are translated on
    // the way out. The router does that, because only it knows the roster.
    const result = await runner.run({
      chatId,
      text,
      mentions,
      requestId: this.teamRequestId(requestIdFor(payload, messageId)),
      mode: this.runModeFor(chatId),
    });

    this.assertScope(epoch);
    return {
      messageId: userMessage.messageId,
      turnId: result?.turnId,
      sessionId: result?.sessionId ?? runner.sessionFor(chatId),
    };
  }

  /**
   * Where a turn in this conversation runs.
   *
   * A group is always the team's: who speaks first, who the admin is and who hands
   * over to whom are the team's rules. A Bot's own chat is the phone's to choose.
   *
   * @param {string} chatId
   * @returns {'team' | 'hosted'}
   */
  runModeFor(chatId) {
    if (!String(chatId ?? '').startsWith('bot:')) return 'team';
    const botId = String(chatId).slice(4);
    const chosen = this.config?.botModes?.[botId];
    return chosen === 'hosted' ? 'hosted' : DEFAULT_RUN_MODE;
  }

  /**
   * Sets where a Bot's turns run, and remembers it.
   *
   * @param {{botId: string, mode: 'team' | 'hosted'}} payload
   */
  async setBotMode(payload, epoch = undefined) {
    const botId = String(payload?.botId ?? '');
    const mode = payload?.mode;
    if (mode !== 'team' && mode !== 'hosted') {
      throw codedError('INVALID_ARGUMENTS', 'A run mode must be either team or hosted.');
    }
    if (!botId) throw codedError('INVALID_ARGUMENTS', 'A Bot id is required.');
    await this.commitConfig((current) => {
      /** @type {Record<string, 'team' | 'hosted'>} */
      const botModes = { ...(current?.botModes ?? {}) };
      botModes[botId] = mode;
      return { ...current, botModes };
    }, { validate: () => { if (epoch !== undefined) this.assertScope(epoch); } });
    this.logger.info('the bridge run mode was set', { botId, mode });
    return { botId, mode };
  }

  react(payload) {
    const { messageId, emoji } = payload;
    if (!messageId || !emoji) {
      throw codedError('INVALID_ARGUMENTS', 'messageId and emoji are required.');
    }
    if ([...String(emoji)].length > MAX_REACTION_EMOJI_LENGTH) {
      throw codedError(
        'INVALID_ARGUMENTS',
        `An emoji may be at most ${MAX_REACTION_EMOJI_LENGTH} characters long.`,
      );
    }
    const bucket = this.reactions.get(messageId) ?? new Map();
    bucket.set(emoji, (bucket.get(emoji) ?? 0) + 1);
    this.reactions.set(messageId, bucket);
    // A client that reacts to a million different messages would otherwise make the
    // desktop hold a million buckets. The oldest reaction is the one that goes.
    while (this.reactions.size > MAX_REACTION_MESSAGES) {
      const oldest = this.reactions.keys().next();
      if (oldest.done) break;
      this.reactions.delete(oldest.value);
    }
    const reaction = { messageId, emoji };
    this.emit('evt.reaction_added', { reaction });
    return { reaction };
  }

  /**
   * The reactions of a chat, as a flat list.
   *
   * A reaction the phone gives is the bridge's own count: the desktop's team tools
   * cannot carry one, so the count lives here, in memory, and is read back with the
   * thread — the message it belongs to is the message the phone can see.
   */
  async reactionsFor(chatId) {
    const { messages } = await this.historyFor(chatId);
    const out = [];
    for (const message of messages) {
      const bucket = this.reactions.get(message.messageId);
      if (!bucket) continue;
      for (const [emoji, count] of bucket) {
        out.push({ messageId: message.messageId, emoji, count });
      }
    }
    return out;
  }

  /**
   * Keeps the tool calls of a turn the bridge runs itself.
   *
   * The phone is told about every call as it happens, and this remembers them, so that
   * a phone which opens the chat afterwards sees the same work the live view showed.
   * A turn the team runs is not kept here: the desktop's own transcript holds it, and
   * that record is read back from there.
   */
  rememberToolCall(type, payload, mode) {
    const chatId = payload?.chatId;
    const turnId = payload?.turnId;
    const toolName = payload?.toolName;
    if (typeof chatId !== 'string' || !chatId) return;
    if (typeof turnId !== 'string' || !turnId) return;
    if (typeof toolName !== 'string' || !toolName) return;
    if ((mode ?? this.runModeFor(chatId)) !== 'hosted') return;
    const list = this.activity.get(chatId) ?? [];
    const callId =
      typeof payload?.callId === 'string' && payload.callId ? payload.callId : `${turnId}:${toolName}:${list.length}`;
    const index = list.findIndex((entry) => entry.callId === callId);
    if (type === 'evt.tool_started') {
      if (index >= 0) return;
      list.push({ turnId, callId, toolName, status: 'running', startedAt: Date.now() });
    } else {
      if (index < 0) return;
      const durationMs = typeof payload?.usage?.durationMs === 'number' ? payload.usage.durationMs : undefined;
      list[index] = {
        ...list[index],
        status: payload?.ok === true ? 'ok' : 'failed',
        ...(durationMs === undefined ? {} : { durationMs }),
        ...(typeof payload?.error === 'string' && payload.error ? { error: payload.error } : {}),
      };
    }
    this.activity.set(chatId, list);
    // A turn can report tools before committing any message. Such a conversation
    // counts towards the same chat ceiling, rather than growing a second cache.
    if (!this.history.has(chatId)) this.history.set(chatId, []);
    this.trimStoredActivity(chatId);
  }

  /** Retains whole turns as calls arrive, not only when a phone reads them back. */
  trimStoredActivity(chatId) {
    const list = this.activity.get(chatId);
    if (list) {
      const running = new Set(list.filter((entry) => entry.status === 'running').map((entry) => entry.turnId));
      this.activity.set(chatId, trimTurnActivity(list, MAX_ACTIVITY_CALLS, [],
        (turnId) => running.has(turnId) || this.runner.aborts.has(turnId)));
    }
    this.trimChatState();
  }

  /** Drops the oldest settled chat, including both its messages and tool calls. */
  trimChatState() {
    for (const [chatId, messages] of this.history) {
      if (this.history.size <= MAX_TRACKED_CHATS) break;
      const activity = this.activity.get(chatId) ?? [];
      if (messages.some((message) => this.runner.aborts.has(message.turnId)) ||
        activity.some((entry) => entry.status === 'running' || this.runner.aborts.has(entry.turnId))) continue;
      this.history.delete(chatId);
      this.activity.delete(chatId);
    }
  }

  /**
   * The thread of a conversation, as the phone shows it.
   *
   * Two records are read together. The desktop keeps the conversation — a turn the team
   * ran is in the desktop's own transcript, and that transcript outlives anything else.
   * The bridge keeps the turns it ran itself, which the desktop does not know about.
   *
   * A turn the team runs is recorded once, by the desktop, and a turn the bridge runs
   * is recorded once, by the bridge, so the two never show the same message twice.
   * Nothing is copied and nothing is written: the desktop's copy is read as it is.
   *
   * @param {string} chatId
   * @returns {Promise<{messages: Array<any>, activity: Array<any>}>}
   */
  async historyFor(chatId) {
    const epoch = this.lifecycleEpoch;
    const own = this.history.get(chatId) ?? [];
    const ownActivity = this.activity.get(chatId) ?? [];
    const desktop = await desktopMessages(this.context, chatId);
    this.assertScope(epoch);
    // Pairing grants the official Desktop transcript. Room scope protects only
    // bridge-private hosted state and asynchronous callback/result ownership.
    if (desktop.messages.length === 0 && own.length === 0) {
      return { messages: own, activity: ownActivity };
    }
    const byId = new Map();
    for (const message of [...desktop.messages, ...own]) byId.set(message.messageId, message);
    const list = [...byId.values()].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
    const messages = list.length > HISTORY_LIMIT ? list.slice(list.length - HISTORY_LIMIT) : list;
    // The calls are matched by their own id, so a call the desktop's record holds and a
    // call the bridge's own turn made are never counted twice.
    const byCall = new Map();
    for (const entry of [...desktop.activity, ...ownActivity]) byCall.set(entry.callId, entry);
    const activity = this.trimActivity([...byCall.values()], messages);
    return { messages, activity };
  }

  /**
   * The calls of the turns the thread shows.
   *
   * A call whose turn is not in the messages belongs to a turn the reader cannot see, so
   * it goes with that turn. What is left is kept whole: a turn that showed only some
   * of its calls would say that the Bot used fewer tools than it did.
   *
   * @param {Array<any>} entries the calls of the conversation
   * @param {Array<any>} messages the messages the thread shows
   * @returns {Array<any>}
   */
  trimActivity(entries, messages) {
    const turns = turnOrderOf(messages);
    const shown = new Set(turns);
    const kept = entries.filter((entry) => shown.has(entry?.turnId));
    const running = new Set(kept.filter((entry) => entry.status === 'running').map((entry) => entry.turnId));
    return trimTurnActivity(kept, MAX_ACTIVITY_CALLS, turns,
      (turnId) => running.has(turnId) || this.runner.aborts.has(turnId));
  }

  pushHistory(chatId, message) {
    const list = this.history.get(chatId) ?? [];
    // A turn can commit more than once: the team narrates while it works. The newest
    // version of a message replaces the one before it, exactly as the phone renders it.
    const index = list.findIndex((entry) => entry.messageId === message.messageId);
    if (index >= 0) {
      list[index] = message;
    } else {
      list.push(message);
    }
    // A message that replaced an earlier one carries a newer `ts`, so the list is put
    // back in order: the phone sorts by `ts` when it renders, and a thread that reads
    // differently after a reload is a thread that reads wrong.
    list.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
    if (list.length > HISTORY_LIMIT) list.splice(0, list.length - HISTORY_LIMIT);
    this.history.set(chatId, list);
    this.trimStoredActivity(chatId);
  }

  /** @param {{chatId: string, durationMs: number, result?: import('./contracts.d.ts').HostRunResult, error?: unknown}} info */
  onTurnFinished({ chatId, durationMs, result, error }) {
    const author = authorIdFor(chatId);
    this.ledger.recordTurn({
      botId: author ?? 'unknown',
      botName: author,
      chars: result?.text?.length ?? 0,
      durationMs,
      error: Boolean(error) || result?.status === 'error',
      tokens: usageNumber(result?.usage, ['totalTokens', 'total']),
      cost: usageNumber(result?.usage, ['cost', 'totalCost']),
    });
    return this.persistLedger('the turn outcome');
  }

  // -- local views ---------------------------------------------------------

  teamSnapshot() {
    return {
      bots: [],
      groups: [],
      diagnostics: this.diagnostics(),
      tools: this.tools.catalog,
    };
  }

  /**
   * Asks the relay for a fresh token and keeps it.
   *
   * The relay signs the new token and kills every older one, so a token that
   * leaked stops working the moment it is replaced.
   *
   * @returns {Promise<string>} the new token
   */
  async rotateToken() {
    const configEpoch = this.configEpoch;
    const relayEpoch = this.relay.epoch;
    const original = this.config;
    const originalRoom = this.roomIdentity(original);
    const validate = () => {
      if (configEpoch !== this.configEpoch || relayEpoch !== this.relay.epoch ||
          originalRoom !== this.roomIdentity() || original?.bridgeToken !== this.config?.bridgeToken) {
        throw new Error('The relay configuration changed during token rotation.');
      }
    };
    // Network work does not hold the persistence queue. The client must not install
    // the token until this same configuration wins its serialized disk commit.
    const token = await this.relay.rotateToken({ commit: false });
    await this.commitConfig((current) => ({ ...current, bridgeToken: token }), { validate });
    const committedEpoch = this.configEpoch;
    const assertInstalled = () => {
      if (committedEpoch !== this.configEpoch || relayEpoch !== this.relay.epoch ||
          this.config?.bridgeToken !== token) {
        throw new Error('The relay configuration changed during token rotation.');
      }
    };
    assertInstalled();
    this.ledger.recordAccessChange({
      action: 'bridge-token-rotated',
      subject: original?.bridgeId ?? 'unknown',
      detail: 'the previous bridge token was revoked',
    });
    await this.persistLedger('the token rotation');
    assertInstalled();
    if (this.onToken) await this.onToken(token);
    assertInstalled();
    this.logger.info('the bridge token was rotated');
    return token;
  }

  /**
   * Replaces the token before it runs out.
   *
   * The bridge cannot mint for itself — only the operator holding the relay
   * secret can — so a token that quietly expired would take the desktop offline
   * until it was re-minted by hand. It rotates itself while the current one is
   * still good enough to ask for a replacement.
   *
   * @param {number} [withinMs] how close to the expiry counts as "about to run out"
   * @returns {Promise<boolean>} whether it rotated
   */
  async rotateTokenIfExpiring(withinMs = 6 * 60 * 60 * 1000) {
    const expiresAt = this.relay.tokenExpiresAt();
    if (expiresAt === null) return false;
    if (expiresAt - Date.now() > withinMs) return false;
    try {
      await this.rotateToken();
      return true;
    } catch (error) {
      this.logger.warn(
        `the bridge token could not be rotated: ${error instanceof Error ? error.message : error}`,
      );
      return false;
    }
  }
}

/**
 * Builds an error that carries the protocol's error code.
 *
 * @param {string} code
 * @param {string} message
 * @param {boolean} [retryable]
 * @param {unknown} [details] extra context, e.g. the tool's live schema
 * @returns {Error & {code: string, retryable: boolean, details?: unknown}}
 */
function codedError(code, message, retryable = false, details) {
  const error = new Error(message);
  return Object.assign(error, { code, retryable, ...(details ? { details } : {}) });
}

/**
 * The request id a turn carries into the team.
 *
 * The team deduplicates retries by request id, so the same phone message must always
 * carry the same one: a retry after a lost answer asks the Bot once, not twice. The
 * phone's own message id is used when it has one, because that id is stable across a
 * retry.
 *
 * @param {Record<string, any>} payload
 * @param {string} messageId
 * @returns {string}
 */
function requestIdFor(payload, messageId) {
  const chosen = isValidClientMessageId(payload.clientMessageId) ? payload.clientMessageId : messageId;
  return `phone-${chosen}`;
}

/** Pulls a JSON object out of a tool result, whatever envelope it arrived in. */
export function extractData(result) {
  if (!result) return undefined;
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    const structured = result.structuredContent;
    if ('data' in structured && structured.data && typeof structured.data === 'object') {
      return structured.data;
    }
    if (Array.isArray(structured)) return structured;
    return structured;
  }
  const content = result.content;
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
      if (block && block.type === 'text' && typeof block.text === 'string') {
        return { text: block.text };
      }
    }
  }
  if (typeof content === 'string') {
    try {
      return JSON.parse(content);
    } catch {
      return { text: content };
    }
  }
  return undefined;
}

/** Reads only supplied, finite usage; absent usage is not estimated. */
function usageNumber(usage, names) {
  if (!usage || typeof usage !== 'object') return undefined;
  for (const name of names) {
    const value = usage[name];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  }
  return undefined;
}

/** Reads token usage out of a tool receipt, when the receipt carries it. */
export function extractTokens(result) {
  const data = extractData(result);
  if (!data || typeof data !== 'object') return 0;
  const usage = data.usage ?? data.tokenUsage ?? data.tokens;
  if (typeof usage === 'number') return usage;
  if (usage && typeof usage === 'object') {
    const total = usage.total ?? usage.totalTokens;
    return typeof total === 'number' ? total : 0;
  }
  return 0;
}
