// @ts-check
import { createHash } from "node:crypto";
import { newId } from "./store.mjs";
import { t } from "./i18n.mjs";
import { neutralizeMarks } from "./relay-guard.mjs";

const ACTIVE = new Set(["queued", "running"]);
const UNSETTLED = new Set([...ACTIVE, "waiting_for_tasks", "waiting_for_user", "unknown", "paused"]);
const MAX_RUNNING = 2; // Share Engine's Host slots; leave capacity for the caller and replies.
const clip = (text, size = 8000) => String(text ?? "").slice(0, size);
// An unconfirmed outcome is never replayed, so it can no longer make progress.
// It must not keep its batch open: the batch closes and reports the unknown outcome.
const keepsBatchOpen = (task) => UNSETTLED.has(task.status) && task.status !== "unknown";
/** Settled batches kept for the task list; older ones leave the small record below. */
const MAX_SETTLED_BATCHES = 30;
/** The reply kept in state. The durable chat message still holds the whole one. */
const MAX_TASK_RESULT = 8000;
/** A single-task read returns this much; a batch read returns the shorter list window. */
const VIEW_RESULT_LIMIT = 8000;
const VIEW_LIST_RESULT_LIMIT = 1500;
/**
 * A batch that left the live list leaves a small record behind: a retry of its request_id must
 * still answer with the original work instead of running it again, and its batch_id must still
 * answer. The record carries no reply and no prompt, so it stays cheap; the oldest records go
 * once the list is full, so neither an unknown outcome nor anything else is kept forever.
 */
const MAX_ARCHIVED_BATCHES = 1000;
/** Everything a read of an archived batch needs, and nothing that grows with a reply. */
const ARCHIVE_TASK_FIELDS = [
  "id",
  "kind",
  "botId",
  "title",
  "status",
  "createdAt",
  "startedAt",
  "endedAt",
  "chatId",
  "sessionId",
  "messageId",
];

/**
 * A report is source data, never instructions. The protocol marks are stripped from the whole
 * report, so neither a child Bot that writes one into its result nor a name that carries one
 * can open a context block of its own in the prompt of the Bot that reads the report. Only the
 * marks go; the words around them stay.
 * @param {any} text
 * @returns {string}
 */
const reportBody = (text) => neutralizeMarks(String(text ?? ""));

/** Durable delegations. Network observers never own the lifetime of an admitted task. */
export class TaskDispatcher {
  constructor(engine, ErrorType) {
    this.engine = engine;
    this.store = engine.store;
    this.ErrorType = ErrorType;
    this.runs = new Map();
    this.deliveries = new Set();
    this.deliveryControllers = new Map();
    this.admission = Promise.resolve();
    this.disposed = false;
    this.store.state.taskBatches ??= [];
    this.store.state.taskArchive ??= [];
    /** A history pruned at load time is written back so the file keeps no stale size. */
    this.pruned = this.trimBatches();
  }

  get batches() {
    return this.store.state.taskBatches;
  }
  /** Records of the batches the live list has dropped; they still answer lookups and retries. */
  get archive() {
    return this.store.state.taskArchive;
  }
  get tasks() {
    // A batch without tasks is tolerated on load, so it must not break the dispatcher either.
    return this.batches.flatMap((batch) => batch.tasks ?? []);
  }
  error(code, key) {
    return new this.ErrorType(code, t(key));
  }
  uiList() {
    const items = this.batches.flatMap((batch) =>
      batch.tasks.map((task) => ({
        id: task.id,
        batchId: batch.id,
        kind: task.kind,
        botId: task.botId,
        chatId:
          task.chatId ??
          (task.kind === "discussion"
            ? `group:${batch.groupId}`
            : `bot:${task.botId}`),
        originChatId: batch.originChatId,
        resultChatId: batch.originChatId,
        title: task.title,
        task: clip(task.text, 1000),
        status: task.status,
        error: task.error,
        pauseReason: task.pauseReason,
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        sessionId: task.sessionId,
        resultMessageId: task.messageId,
      })),
    );
    return [
      ...items.filter((task) => UNSETTLED.has(task.status)),
      ...items.filter((task) => !UNSETTLED.has(task.status)).slice(-30),
    ];
  }
  changed() {
    this.engine.broadcast({ type: "tasks.changed", tasks: this.uiList() });
  }
  async save() {
    this.trimBatches();
    await this.store.save();
    this.changed();
  }

  /** A batch still owes work: a task that can still run, an undelivered report, or a live parent link. */
  batchActive(batch) {
    // An unconfirmed outcome cannot make progress any more, so it does not keep the batch open:
    // the batch closes and says so, and the trim may take the batch away like any settled one.
    if ((batch.tasks ?? []).some(keepsBatchOpen)) return true;
    if (batch.notification === "pending" || batch.notification === "delivering") return true;
    const parent = this.task(batch.parentTaskId);
    return Boolean(
      parent && this.pendingDependencies(parent).some((dependency) => dependency.id === batch.id),
    );
  }

  /** Keeps every active batch and the most recent settled ones; older ones leave a small record. */
  trimBatches() {
    const batches = this.batches;
    const settled = batches.filter((batch) => !this.batchActive(batch));
    if (settled.length <= MAX_SETTLED_BATCHES) return false;
    const drop = new Set(
      settled.slice(0, settled.length - MAX_SETTLED_BATCHES).map((batch) => batch.id),
    );
    for (const batch of batches) if (drop.has(batch.id)) this.archiveBatch(batch);
    const kept = batches.filter((batch) => !drop.has(batch.id));
    this.batches.length = 0;
    for (const batch of kept) this.batches.push(batch);
    return true;
  }

  /** The small record a dropped batch leaves: what a lookup and a retry still need. */
  archiveBatch(batch) {
    this.archive.push({
      id: batch.id,
      owner: batch.owner,
      requestId: batch.requestId,
      fingerprint: batch.fingerprint,
      continuations: (batch.continuations ?? []).map(({ requestId, fingerprint }) => ({
        requestId,
        fingerprint,
      })),
      callerId: batch.callerId,
      originChatId: batch.originChatId,
      groupId: batch.groupId,
      parentTaskId: batch.parentTaskId,
      createdAt: batch.createdAt,
      notification: batch.notification,
      tasks: (batch.tasks ?? []).map((task) => {
        /** @type {any} */
        const record = { resultTruncated: Boolean(task.result || task.resultTruncated) };
        for (const field of ARCHIVE_TASK_FIELDS) record[field] = task[field];
        return record;
      }),
    });
    // The records are a bounded history, not a second copy of everything that ever ran.
    if (this.archive.length > MAX_ARCHIVED_BATCHES)
      this.archive.splice(0, this.archive.length - MAX_ARCHIVED_BATCHES);
  }

  task(id) {
    return this.tasks.find((task) => task.id === id);
  }

  pendingDependencies(task) {
    return (task?.dependencies ?? []).filter((dependency) => !dependency.consumed);
  }

  /** The dependency and its admission are persisted in the same state.json write. */
  attachDependency(turn, kind, id) {
    const parent = this.task(turn?.message?.taskId);
    if (!parent) return undefined;
    if (parent.status !== "running" || parent.cancelRequested)
      throw this.error("cancelled", "task.cancelled");
    (parent.dependencies ??= []).push({ kind, id, botId: turn.botId });
    return parent.id;
  }

  detachDependency(parentId, id) {
    const parent = this.task(parentId);
    if (parent) parent.dependencies = parent.dependencies.filter((dependency) => dependency.id !== id);
  }

  batchReport(batch) {
    return reportBody(t("task.results", { id: batch.id }) + "\n" + batch.tasks.map((task) => {
      const report = `${this.store.getBot(task.botId)?.name ?? task.title} [${task.status}] (${task.id})\n${clip(task.result || task.error || "-", 4000)}`;
      // An unconfirmed outcome has no output to show: say so instead of a bare status code.
      return task.status === "unknown" ? `${report}\n${t("task.unknownOutcome")}` : report;
    }).join("\n\n"));
  }

  helperReport(helper) {
    if (helper.status === "stopped") return reportBody(`${helper.title} [stopped]`);
    return reportBody(t(`helper.trigger.${helper.status}`, {
      title: helper.title, id: helper.id, report: helper.report || "-", error: helper.error || "-",
    }));
  }

  async receiveDependency(parentId, id, text) {
    const parent = this.task(parentId);
    const dependency = this.pendingDependencies(parent).find((item) => item.id === id);
    if (!dependency || dependency.report === text) return;
    dependency.report = text;
    await this.save();
    this.pump();
  }

  /** Recover only durable outputs. A lost child/verification run is never replayed. */
  reconcileDependencies(task) {
    for (const dependency of this.pendingDependencies(task)) {
      if (dependency.report !== undefined) continue;
      if (dependency.kind === "helper") {
        const helper = this.store.state.helpers.find((item) => item.id === dependency.id);
        if (!helper || helper.status === "interrupted") {
          task.status = "unknown";
          task.error = "dependency_outcome_unknown";
        } else if (!["queued", "running"].includes(helper.status)) {
          dependency.report = this.helperReport(helper);
        }
      } else {
        const batch = this.batches.find((item) => item.id === dependency.id);
        if (!batch || batch.tasks.some((child) => child.status === "unknown") || batch.notification === "unknown") {
          task.status = "unknown";
          task.error = "dependency_outcome_unknown";
        } else if (batch.notification !== "pending" && batch.notification !== "delivering" &&
          batch.tasks.every((child) => !UNSETTLED.has(child.status))) {
          dependency.report = this.batchReport(batch);
        }
      }
    }
  }

  cancelDependencies(task) {
    for (const dependency of this.pendingDependencies(task)) {
      if (dependency.kind === "helper") {
        if (this.store.state.helpers.some((helper) => helper.id === dependency.id))
          this.engine.stopHelper(undefined, dependency.id);
      } else {
        const batch = this.batches.find((item) => item.id === dependency.id);
        this.deliveryControllers.get(dependency.id)?.abort();
        for (const child of batch?.tasks ?? []) this.cancelTask(child);
      }
    }
  }

  cancelTask(task) {
    if (!UNSETTLED.has(task.status) || task.status === "unknown") return;
    task.cancelRequested = true;
    this.cancelDependencies(task);
    const run = this.runs.get(task.id);
    if (run) run.controller.abort();
    if (!run || task.status !== "running") { task.status = "cancelled"; task.endedAt = Date.now(); }
  }

  resolveBot(ref) {
    const bot = this.store.getBot(ref);
    if (!bot) throw this.error("not_found", "task.botMissing");
    return bot;
  }

  resolveGroup(ref, caller) {
    if (!ref) return undefined;
    const group = this.store.getGroup(ref);
    if (!group) throw this.error("not_found", "err.groupMissing");
    if (caller && !caller.isMain && !group.memberIds.includes(caller.id))
      throw new this.ErrorType(
        "forbidden",
        t("err.groupPostNotMember", { name: caller.name, group: group.name }),
      );
    return group;
  }

  own(batch, caller) {
    if (caller && !caller.isMain && batch.callerId !== caller.id)
      throw this.error("forbidden", "task.notAllowed");
    return batch;
  }

  /** One serialized admission commits the idempotency key and every task before any runs. */
  async dispatch(caller, args, invocation, discussion = false) {
    const turn = invocation?.turn ?? this.engine.bindCallerTurn(caller?.id);
    if (["result_group", "summarize_by", "budget_seconds"].some((key) => key in args))
      throw this.error("invalid", "task.unsupportedOptions");
    const requestId = String(args.request_id ?? "").trim();
    if (!/^[\w.-]{1,128}$/.test(requestId))
      throw this.error("invalid", "task.requestId");
    const group = this.resolveGroup(
      discussion ? args.group : undefined,
      caller,
    );
    if (discussion && !group) throw this.error("invalid", "err.groupMissing");
    if (discussion && turn?.chatId.startsWith("group:"))
      throw this.error("invalid", "err.postFromGroup");
    const inputs = discussion ? [{ message: args.message }] : args.tasks;
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > 32)
      throw this.error("invalid", "task.tasksInvalid");
    const jobs = inputs.map((input) => {
      const text = String(input.message ?? "").trim();
      if (!text || text.length > 20000)
        throw this.error("invalid", "task.messageInvalid");
      const bot = discussion ? undefined : this.resolveBot(input.to);
      if (bot && group && !group.memberIds.includes(bot.id))
        throw this.error("invalid", "task.summaryMember");
      return {
        kind: discussion ? "discussion" : "bot",
        botId: bot?.id,
        text,
        title: clip(input.title || text.replace(/\s+/g, " "), 80),
      };
    });
    const owner = caller?.id ?? "user";
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          jobs,
          group: group?.id,
        }),
      )
      .digest("hex");
    const admit = async () => {
      // A batch that left the live list still answers: its request_id must never start the
      // same work again, so the record it left behind is searched as well.
      const known = (batch) =>
        batch.owner === owner &&
        (batch.requestId === requestId ||
          (batch.continuations ?? []).some((item) => item.requestId === requestId));
      const prior = this.batches.find(known) ?? this.archive.find(known);
      if (prior) {
        const previousFingerprint = prior.requestId === requestId ? prior.fingerprint : prior.continuations.find((item) => item.requestId === requestId).fingerprint;
        if (previousFingerprint !== fingerprint)
          throw this.error("conflict", "task.requestConflict");
        return this.view(prior);
      }
      if (invocation?.signal?.aborted)
        throw this.error("cancelled", "task.cancelled");
      this.engine.requireCallerTurn(caller, { turn });
      if (discussion && this.engine.isBusy(`group:${group.id}`))
        throw this.error("busy", "err.groupBusy");
      const pausedBatch = discussion && this.batches.findLast((batch) => batch.groupId === group.id &&
        batch.owner === owner && batch.originChatId === turn?.chatId && (!turn?.message?.taskId || batch.parentTaskId === turn.message.taskId) &&
        batch.tasks.some((task) => task.kind === "discussion" && task.status === "paused"));
      if (pausedBatch) {
        const task = pausedBatch.tasks.find((item) => item.status === "paused");
        const previous = structuredClone(task);
        (pausedBatch.continuations ??= []).push({ requestId, fingerprint });
        task.followup = { id: newId("msg"), text: jobs[0].text };
        task.remaining = [...new Set([...this.engine.groupQueue(group, jobs[0].text), ...(task.remaining ?? [])])];
        task.cancelRequested = false;
        task.pauseReason = undefined;
        task.endedAt = undefined;
        task.status = this.pendingDependencies(task).length ? "waiting_for_tasks" : "queued";
        try { await this.save(); }
        catch (error) {
          pausedBatch.continuations.pop();
          for (const key of Object.keys(task)) delete task[key];
          Object.assign(task, previous);
          throw error;
        }
        const receipt = this.view(pausedBatch);
        queueMicrotask(() => this.pump());
        return receipt;
      }
      const batch = {
        id: newId("batch"),
        owner,
        requestId,
        fingerprint,
        callerId: caller?.id,
        originChatId: turn?.chatId,
        groupId: group?.id,
        createdAt: Date.now(),
        notification: "pending",
        tasks: jobs.map((job) => ({
          ...job,
          id: newId("task"),
          status: "queued",
          createdAt: Date.now(),
        })),
      };
      batch.parentTaskId = this.attachDependency(turn, "batch", batch.id);
      this.batches.push(batch);
      try {
        await this.save();
      } catch (error) {
        const index = this.batches.indexOf(batch);
        if (index >= 0) this.batches.splice(index, 1);
        this.detachDependency(batch.parentTaskId, batch.id);
        throw error;
      }
      const parent = this.task(batch.parentTaskId);
      if (parent && (parent.cancelRequested)) {
        for (const task of batch.tasks) this.cancelTask(task);
        await this.save();
      }
      // Capture the receipt before scheduling can change queued to running.
      const receipt = this.view(batch);
      queueMicrotask(() => this.pump());
      return receipt;
    };
    const promise = this.admission.then(admit, admit);
    this.admission = promise.then(
      () => {},
      () => {},
    );
    return promise;
  }

  view(batch, taskId, offset = 0, fullResults = new Map()) {
    const tasks = taskId
      ? batch.tasks.filter((task) => task.id === taskId)
      : batch.tasks;
    const limit = taskId ? VIEW_RESULT_LIMIT : VIEW_LIST_RESULT_LIMIT;
    return {
      batch_id: batch.id,
      request_id: batch.requestId,
      notification: batch.notification,
      complete: batch.tasks.every((task) => !keepsBatchOpen(task)),
      tasks: tasks.map((task) => {
        const result = String(fullResults.get(task.id) ?? task.result ?? "");
        return {
          task_id: task.id,
          kind: task.kind,
          bot_id: task.botId,
          title: task.title,
          status: task.status,
          ...(task.dependencies?.length ? { dependencies: task.dependencies.map(({ kind, id, consumed }) => ({ kind, id, reviewed: Boolean(consumed) })) } : {}),
          chat_id: task.chatId,
          session_id: task.sessionId,
          result_message_id: task.messageId,
          created_at: task.createdAt,
          started_at: task.startedAt,
          ended_at: task.endedAt,
          ...(task.error ? { error: task.error } : {}),
          ...(task.pauseReason ? { pause_reason: task.pauseReason } : {}),
          // State keeps a window of a long reply; the whole one is read from the chat message.
          ...(task.resultTruncated && !fullResults.has(task.id) ? { result_truncated: true } : {}),
          ...(result
            ? {
                result: result.slice(offset, offset + limit),
                result_offset: offset,
                next_result_offset:
                  offset + limit < result.length ? offset + limit : null,
              }
            : {}),
        };
      }),
    };
  }

  select(caller, args) {
    if (Boolean(args.task_id) === Boolean(args.batch_id))
      throw this.error("invalid", "task.selectorInvalid");
    // An old batch_id still answers: the trimmed batches left a record behind.
    const find = (batch) =>
      args.task_id
        ? (batch.tasks ?? []).some((task) => task.id === args.task_id)
        : batch.id === args.batch_id;
    const batch = this.batches.find(find) ?? this.archive.find(find);
    if (!batch) throw this.error("not_found", "task.notFound");
    return this.own(batch, caller);
  }

  async get(caller, args) {
    const wait = args.wait_ms ?? 0;
    const offset = args.result_offset ?? 0;
    if (
      !Number.isInteger(wait) ||
      wait < 0 ||
      wait > 20000 ||
      !Number.isInteger(offset) ||
      offset < 0
    )
      throw this.error("invalid", "task.waitInvalid");
    const batch = this.select(caller, args);
    const deadline = Date.now() + wait;
    const selected = () =>
      batch.tasks.filter((task) => !args.task_id || task.id === args.task_id);
    const original = selected()
      .map((task) => task.status)
      .join(",");
    while (
      !this.disposed &&
      wait &&
      selected().some((task) => ACTIVE.has(task.status) || task.status === "waiting_for_tasks") &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(100, deadline - Date.now())),
      );
      if (
        selected()
          .map((task) => task.status)
          .join(",") !== original
      )
        break;
    }
    return this.view(batch, args.task_id, offset, await this.fullResults(batch, args.task_id));
  }

  /** A clipped result is only a window: the durable chat message still holds the whole reply. */
  async fullResults(batch, taskId) {
    const results = new Map();
    for (const task of batch.tasks) {
      if (taskId && task.id !== taskId) continue;
      if (!task.resultTruncated) continue;
      const full = await this.storedResult(task);
      if (full !== undefined) results.set(task.id, full);
    }
    return results;
  }

  /** The Bot's reply is durable in its chat; state only keeps a window of it. */
  async storedResult(task) {
    if (!task.chatId || !task.messageId) return undefined;
    const messages = await this.store.getMessages(task.chatId);
    const message = messages.find((item) => item.id === task.messageId);
    return typeof message?.text === "string" ? message.text : undefined;
  }

  async cancel(caller, args) {
    const batch = this.select(caller, args);
    for (const task of batch.tasks) {
      if (args.task_id && args.task_id !== task.id) continue;
      this.cancelTask(task);
    }
    await this.save();
    void this.deliver(batch);
    return this.view(batch, args.task_id);
  }

  /** A normal group message continues the latest safely paused discussion in that chat. */
  async continueDiscussion(group, messages, cancelled) {
    // Host tickets finish before their task status is persisted. Wait for that local
    // settlement, but not result delivery (which itself waits for this inbox).
    await Promise.all([...this.runs.values()].filter((run) => run.key === `group:${group.id}`).map((run) => run.settled));
    if (cancelled?.()) return { status: "aborted", skipped: true, accepted: false, safeToContinue: true };
    const batch = this.batches.findLast((item) => item.groupId === group.id &&
      item.tasks.some((task) => task.kind === "discussion" && task.status === "paused"));
    const task = batch?.tasks.find((item) => item.kind === "discussion" && item.status === "paused");
    if (!task || this.runs.has(task.id)) return undefined;
    task.pauseReason = undefined;
    task.cancelRequested = false;
    task.endedAt = undefined;
    task.continuationSources = messages.map((message) => message.id);
    task.remaining = [...new Set([...this.engine.groupQueue(group, messages.map((message) => message.text).join("\n")), ...(task.remaining ?? [])])];
    if (this.pendingDependencies(task).length) {
      task.status = "waiting_for_tasks";
      await this.save();
      this.pump();
      return { status: "done", accepted: true, safeToContinue: true };
    }
    // The inbox owns this chat, so admit its continuation directly rather than waiting on itself.
    const run = { key: `group:${group.id}`, controller: new AbortController() };
    this.runs.set(task.id, run);
    run.done = this.run(batch, task, run);
    return run.done;
  }

  start() {
    this.pump();
    for (const batch of this.batches) void this.deliver(batch);
    if (this.pruned) {
      this.pruned = false;
      void this.save().catch(() => {});
    }
  }

  pump() {
    if (this.disposed) return;
    for (const batch of this.batches) {
      for (const task of batch.tasks) {
        if (task.cancelRequested && ["queued", "waiting_for_tasks"].includes(task.status)) {
          this.cancelTask(task);
          void this.save().catch(() => {});
        }
        if (task.status === "waiting_for_tasks") {
          this.reconcileDependencies(task);
          if (task.status === "unknown") {
            void this.save().catch(() => {});
            // The batch can no longer make progress: close it and report the unknown outcome.
            void this.deliver(batch).catch(() => {});
            continue;
          }
          const dependencies = this.pendingDependencies(task);
          if (dependencies.length && dependencies.every((dependency) => dependency.report !== undefined)) {
            // The one place a dependency report reaches the Bot that verifies it. A report kept
            // from an earlier run is stripped here as well, so no mark survives into the prompt.
            task.review = { botId: dependencies[0].botId, ids: dependencies.map((dependency) => dependency.id),
              text: t("task.dependencyPrompt") + "\n\n" + dependencies.map((dependency) => reportBody(dependency.report)).join("\n\n") };
            task.status = "queued";
          }
        }
        if (this.runs.size >= MAX_RUNNING) return;
        if (task.status !== "queued" || this.runs.has(task.id)) continue;
        // Leave occupied chats queued without consuming a task worker.
        const key = task.kind === "discussion" ? `group:${batch.groupId}` : `bot:${task.botId}`;
        if (this.engine.isBusy(key) || (task.botId && this.engine.queues.has(`${key}::${task.botId}`))) continue;
        if ([...this.runs.values()].some((run) => run.key === key)) continue;
        const run = { key, controller: new AbortController() };
        this.runs.set(task.id, run);
        run.done = this.run(batch, task, run).catch((error) =>
          this.engine.logger.warn("minimax_bot.task_failed", {
            taskId: task.id,
            code: error?.code ?? "unknown",
          }),
        );
      }
    }
  }

  async run(batch, task, run) {
    let release;
    run.settled = new Promise((resolve) => { release = resolve; });
    try {
      task.status = "running";
      task.startedAt ??= Date.now();
      const review = task.review;
      if (review) {
        for (const dependency of this.pendingDependencies(task))
          if (review.ids.includes(dependency.id)) dependency.consumed = true;
        task.review = undefined;
      }
      await this.save();
      if (run.controller.signal.aborted || this.disposed) {
        task.status = this.disposed ? "unknown" : "cancelled";
        return { status: "aborted", skipped: true, accepted: false, safeToContinue: !this.disposed };
      }
      let result;
      if (task.followup) {
        const note = await this.store.appendMessage(task.chatId, { ...task.followup, role: "relay", taskId: task.id,
          fromBotId: batch.callerId, fromName: this.store.getBot(batch.callerId)?.name ?? t("relay.fromUserSession") });
        this.engine.broadcast({ type: "message.upsert", chatId: task.chatId, message: note });
        task.continuationSources = [note.id];
        task.followup = undefined;
      }
      if (review) {
        result = await this.engine.runBotTurn({
          bot: this.resolveBot(review.botId), chatId: task.chatId, text: review.text,
          kind: "task_review", taskId: task.id, signal: run.controller.signal,
          sourceMessageIds: task.continuationSources,
        });
      } else if (task.kind === "discussion") {
        const group = this.store.getGroup(batch.groupId);
        if (!group) throw this.error("not_found", "err.groupMissing");
        task.chatId = `group:${group.id}`;
        const post = await this.store.appendMessage(task.chatId, {
          id: `msg_${task.id}`,
          role: "relay",
          fromBotId: batch.callerId,
          fromName:
            this.store.getBot(batch.callerId)?.name ??
            t("relay.fromUserSession"),
          text: task.text,
          taskId: task.id,
        });
        this.engine.broadcast({
          type: "message.upsert",
          chatId: task.chatId,
          message: post,
        });
        result = await this.engine.driveGroup(
          group,
          task.remaining ?? this.engine.groupQueue(group, task.text),
          task.continuationSources?.[0] ?? post.id,
          task.continuationSources,
          { signal: run.controller.signal, taskId: task.id },
        );
        task.remaining = result.remaining;
      } else {
        const bot = this.resolveBot(task.botId);
        task.chatId = `bot:${bot.id}`;
        const post = await this.store.appendMessage(task.chatId, {
          id: `msg_${task.id}`,
          role: "relay",
          fromBotId: batch.callerId,
          fromName:
            this.store.getBot(batch.callerId)?.name ??
            t("relay.fromUserSession"),
          text: task.text,
          taskId: task.id,
        });
        this.engine.broadcast({
          type: "message.upsert",
          chatId: task.chatId,
          message: post,
        });
        result = await this.engine.runBotTurn({
          bot,
          chatId: task.chatId,
          text: task.text,
          kind: "delegation",
          sourceMessageId: post.id,
          taskId: task.id,
          signal: run.controller.signal,
        });
      }
      if (review && (result.skipped || result.status === "aborted") && result.safeToContinue !== false) {
        task.review = review;
        // Ordinary group input interrupts a review just like a member's discussion turn.
        // Keep its evidence and task identity for the inbox to continue safely.
        if (task.kind === "discussion" && !task.cancelRequested && !this.disposed)
          result = { ...result, paused: "interrupted" };
      }
      if (review) await this.answered(task.id, result);
      else await this.settle(task, result);
      return result;
    } catch (error) {
      task.status = task.sessionId || this.disposed ? "unknown" : "failed";
      task.error = error?.code ?? "task_execution_failed";
      return { status: "error", errorCode: task.error, accepted: Boolean(task.sessionId), safeToContinue: task.status !== "unknown" };
    } finally {
      if (!UNSETTLED.has(task.status)) task.endedAt = Date.now();
      await this.save().catch((error) =>
        this.engine.logger.warn("minimax_bot.task_save_failed", {
          taskId: task.id,
          code: error?.code ?? "unknown",
        }),
      );
      this.runs.delete(task.id);
      release();
      this.pump();
      if (!this.disposed) await this.deliver(batch);
    }
  }

  async settle(task, result, continueDiscussion = false) {
    task.messageId = result.messageId;
    task.sessionId = result.sessionId ?? task.sessionId;
    // The whole reply stays in the durable chat message; state keeps a window of it.
    const text = String(result.text ?? "");
    task.result = text.slice(0, MAX_TASK_RESULT);
    if (text.length > MAX_TASK_RESULT) task.resultTruncated = true;
    else delete task.resultTruncated;
    task.error = result.errorCode ?? result.error;
    if (
      this.disposed ||
      (result.safeToContinue === false && !result.pendingQuestion)
    )
      task.status = "unknown";
    else if (task.cancelRequested && (result.status !== "done" || result.pendingQuestion || this.pendingDependencies(task).length)) task.status = "cancelled";
    else if (result.pendingQuestion) task.status = "waiting_for_user";
    else if (result.paused) {
      task.status = "paused";
      task.pauseReason = result.paused;
    } else if (result.status === "aborted") task.status = "cancelled";
    else task.status = result.status === "done"
      ? (this.pendingDependencies(task).length ? "waiting_for_tasks" : "done") : "failed";
    if (continueDiscussion && task.status === "done" && task.remaining?.length)
      task.status = "queued";
    task.endedAt = UNSETTLED.has(task.status) ? undefined : Date.now();
    await this.save();
  }

  /** A questionnaire continuation belongs to the original task, not a new delegation. */
  async runAnswer(taskId, execute) {
    const batch = this.batches.find((batch) =>
      batch.tasks.some((task) => task.id === taskId),
    );
    const task = batch?.tasks.find((task) => task.id === taskId);
    if (!task || task.status !== "waiting_for_user" || this.runs.has(taskId))
      throw this.error("invalid", "task.answerUnavailable");
    const run = { key: task.chatId, controller: new AbortController() };
    let release;
    run.settled = new Promise((resolve) => { release = resolve; });
    this.runs.set(taskId, run);
    try {
      task.status = "running";
      await this.save();
      const result = await execute(run.controller.signal);
      if (
        !task.cancelRequested &&
        (result.skipped || (!result.accepted && result.safeToContinue))
      ) {
        task.status = "waiting_for_user";
        await this.save();
      } else await this.answered(taskId, result);
      return result;
    } catch (error) {
      task.status = "unknown";
      task.error = error?.code ?? "answer_outcome_unknown";
      await this.save();
      throw error;
    } finally {
      this.runs.delete(taskId);
      release();
      this.pump();
      if (!this.disposed) await this.deliver(batch);
    }
  }

  async answered(taskId, result) {
    const batch = this.batches.find((batch) =>
      batch.tasks.some((task) => task.id === taskId),
    );
    const task = batch?.tasks.find((task) => task.id === taskId);
    if (!task || task.status !== "running") return;
    // Resolve the next members before persisting a terminal state. A restart must
    // never see "done" while the same discussion still has work to perform.
    if (task.kind === "discussion" && result.status === "done" && !result.pendingQuestion) {
      const group = this.store.getGroup(batch.groupId);
      const speaker = (await this.store.getMessages(task.chatId)).find(
        (message) => message.id === result.messageId,
      )?.botId;
      const next = group
        ? this.engine.mentionsIn(result.text, group, speaker)
        : [];
      task.remaining = [...new Set([...(task.remaining ?? []), ...next])];
    }
    await this.settle(task, result, task.kind === "discussion");
  }

  /** Result messages are durable and idempotent. A crashed summary is not automatically replayed. */
  async deliver(batch) {
    if (
      this.disposed ||
      batch.notification !== "pending" ||
      this.deliveries.has(batch.id) ||
      batch.tasks.some(keepsBatchOpen)
    )
      return;
    this.deliveries.add(batch.id);
    const controller = new AbortController();
    this.deliveryControllers.set(batch.id, controller);
    try {
      const parent = this.task(batch.parentTaskId);
      if (parent && (parent.cancelRequested)) {
        batch.notification = "posted";
        await this.save();
        return;
      }
      // A child reports through the original task's verification turn. It must not
      // start an unrelated private turn that cannot settle that task.
      if (parent) {
        batch.notification = "delivered";
        await this.receiveDependency(parent.id, batch.id, this.batchReport(batch));
        return;
      }
      const chatId = batch.originChatId;
      if (!chatId) {
        batch.notification = "query_only";
        await this.save();
        return;
      }
      const group = chatId.startsWith("group:")
        ? this.store.getGroup(chatId.slice(6))
        : undefined;
      if (chatId.startsWith("group:") && !group) {
        batch.notification = "destination_missing";
        await this.save();
        return;
      }
      const text = this.batchReport(batch);
      const message = await this.store.appendMessage(chatId, {
        id: `msg_result_${batch.id}`,
        role: "relay",
        fromName: t("task.resultSender"),
        text,
        taskBatchId: batch.id,
      });
      this.engine.broadcast({ type: "message.upsert", chatId, message });
      this.engine.broadcastSummary(chatId);
      const bot = this.store.getBot(
        batch.callerId ?? group?.adminId,
      );
      if (!bot || (group && !group.memberIds.includes(bot.id))) {
        batch.notification = "posted";
        await this.save();
        return;
      }
      while (!this.disposed && !controller.signal.aborted && this.engine.isBusy(chatId))
        await new Promise((resolve) => setTimeout(resolve, 100));
      if (this.disposed || controller.signal.aborted) return;
      // Write the claim before invoking: restart keeps delivering as unknown instead of duplicate summaries.
      batch.notification = "delivering";
      await this.save();
      const result = await this.engine.runBotTurn({
        bot,
        chatId,
        kind: "task_report",
        text: t("task.summaryPrompt", { id: batch.id }) + "\n" + text,
        sourceMessageId: message.id,
        signal: controller.signal,
      });
      batch.notification =
        result.status === "done" && !result.pendingQuestion
          ? "delivered"
          : result.safeToContinue === false
            ? "unknown"
            : "posted";
      await this.save();
    } catch (error) {
      batch.notification =
        batch.notification === "delivering" ? "unknown" : "pending";
      await this.save().catch(() => {});
      this.engine.logger.warn("minimax_bot.task_report_failed", {
        batchId: batch.id,
        code: error?.code ?? "unknown",
      });
    } finally {
      this.deliveries.delete(batch.id);
      this.deliveryControllers.delete(batch.id);
      if (batch.parentTaskId && !this.disposed && !["pending", "delivering", "unknown"].includes(batch.notification))
        await this.receiveDependency(batch.parentTaskId, batch.id, this.batchReport(batch));
    }
  }

  stopChat(chatId) {
    for (const batch of this.batches)
      for (const task of batch.tasks) {
        // A source conversation ending never owns the target task. Stop only its execution chat.
        if (
          (task.chatId ??
            (task.kind === "discussion"
              ? `group:${batch.groupId}`
              : `bot:${task.botId}`)) !== chatId
        )
          continue;
        this.cancelTask(task);
      }
    void this.save()
      .then(() => Promise.all(this.batches.map((batch) => this.deliver(batch))))
      .catch(() => {});
  }

  dispose() {
    this.disposed = true;
    for (const run of this.runs.values()) run.controller.abort();
    for (const controller of this.deliveryControllers.values()) controller.abort();
  }
}
