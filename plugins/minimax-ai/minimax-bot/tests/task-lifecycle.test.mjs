import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../miniapp/node/store.mjs";
import { MemoryStore } from "../miniapp/node/memory.mjs";
import { Engine } from "../miniapp/node/engine.mjs";
import { Team } from "../miniapp/node/team.mjs";
import { createMcpHandler } from "../miniapp/node/mcp.mjs";
import { setLocale } from "../miniapp/node/i18n.mjs";
import Ajv from "ajv";
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
async function until(predicate) {
  for (let i = 0; i < 800; i++) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("Timed out waiting for task state");
}
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "bot-tasks-"));
  const store = new Store(dir);
  await store.init();
  const memory = new MemoryStore(dir);
  await memory.init();
  setLocale("en");
  // A restarted store restores the locale from its saved settings.
  store.state.settings.language = "en";
  const a = { id: "bot_a", name: "Alice", isMain: true };
  const b = { id: "bot_b", name: "Bob" };
  const group = {
    id: "grp_review",
    name: "Review",
    adminId: a.id,
    memberIds: [a.id, b.id],
    replyMode: "admin",
  };
  store.state.bots = [a, b];
  store.state.groups = [group];
  await store.save();
  const engine = new Engine({
    store,
    memory,
    logger: { warn() {} },
    broadcast() {},
    retryDelaysMs: [],
  });
  // helperRuns releases the execution slot before final report writes finish.
  // Track the full promises so cleanup never removes a directory still in use.
  const helperCompletions = new Set();
  const runHelper = engine.runHelper.bind(engine);
  engine.runHelper = (...args) => {
    const completion = runHelper(...args);
    helperCompletions.add(completion);
    void completion.then(() => helperCompletions.delete(completion), () => helperCompletions.delete(completion));
    return completion;
  };
  const team = new Team({ store, memory, engine, broadcast() {} });
  const handle = createMcpHandler({ team, engine });
  const rpc = async (name, args = {}, method = "tools/call") => {
    let reply;
    await handle(
      { method: "POST" },
      {
        writeHead() {
          return this;
        },
        end(body) {
          reply = JSON.parse(body);
        },
      },
      { jsonrpc: "2.0", id: 1, method, params: { name, arguments: args } },
    );
    return reply.result;
  };
  t.after(async () => {
    engine.dispose();
    await Promise.allSettled([...helperCompletions]);
    await until(
      () =>
        !engine.tasks.runs.size &&
        !engine.tasks.deliveries.size &&
        !engine.tickets.size,
    );
    await store.writeChain;
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, store, engine, a, b, group, rpc };
}
function agentResult(input, options, text = "Complete", extra = {}) {
  const ids = {
    sessionId: input.sessionId ?? `session-${input.text.slice(-12)}`,
    turnId: "turn",
  };
  options.onEvent({ type: "turn.started", ...ids });
  return { ...ids, status: "finished", text, ...extra };
}
const idle = (engine) =>
  !engine.tasks.runs.size &&
  !engine.tasks.deliveries.size &&
  !engine.tickets.size;

test("tool schema requires stable dispatch IDs and one query selector; create_group names its new group", async (t) => {
  const { rpc } = await fixture(t);
  const { tools } = await rpc(undefined, {}, "tools/list");
  const ajv = new Ajv({ strict: false });
  const check = (name, value) =>
    ajv.compile(tools.find((tool) => tool.name === name).inputSchema)(value);
  assert.equal(
    check("dispatch_tasks", {
      request_id: "review-v1",
      tasks: [{ to: "Alice", message: "Review" }],
    }),
    true,
  );
  assert.equal(
    check("dispatch_tasks", { tasks: [{ to: "Alice", message: "Review" }] }),
    false,
  );
  assert.equal(check("get_tasks", { task_id: "t", batch_id: "b" }), false);
  assert.equal(check("get_tasks", { batch_id: "b", wait_ms: 20001 }), false);
  assert.ok(!tools.some((tool) => tool.name === "resume_task"));
  for (const option of [{ result_group: "g" }, { summarize_by: "b" }, { budget_seconds: 60 }])
    assert.equal(check("dispatch_tasks", { request_id: "work", tasks: [{ to: "Alice", message: "Work" }], ...option }), false);
  assert.equal(
    check("create_group", {
      name: "Review",
      members: ["Alice"],
      group: "Review",
    }),
    false,
  );
  assert.match(
    tools.find((tool) => tool.name === "create_group").inputSchema.properties
      .name.description,
    /name, not group/,
  );
});

test("admission is durable and idempotent; different Bots overlap, each private chat stays serial", async (t) => {
  const { dir, store, engine, a, b } = await fixture(t);
  const gate = deferred();
  const seen = [];
  engine.agent = {
    async run(input, options) {
      const result = agentResult(input, options);
      seen.push(input.text);
      await gate.promise;
      return result;
    },
  };
  t.after(() => gate.resolve());
  const args = {
    request_id: "parallel",
    tasks: [
      { to: a.id, message: "A1" },
      { to: a.id, message: "A2" },
      { to: b.id, message: "B1" },
    ],
  };
  const [first, retry] = await Promise.all([
    engine.tasks.dispatch(undefined, args),
    engine.tasks.dispatch(undefined, args),
  ]);
  assert.equal(first.batch_id, retry.batch_id);
  assert.equal(first.tasks.length, 3);
  assert.equal(store.state.taskBatches.length, 1);
  // Read the actual durable state before allowing execution to finish.
  const disk = JSON.parse(await readFile(store.statePath, "utf8"));
  assert.equal(disk.taskBatches[0].id, first.batch_id);
  await until(() => seen.length === 2);
  assert.ok(seen.some((text) => text.endsWith("A1")));
  assert.ok(seen.some((text) => text.endsWith("B1")));
  assert.ok(!seen.some((text) => text.endsWith("A2")));
  await assert.rejects(
    engine.tasks.dispatch(undefined, {
      ...args,
      tasks: [{ to: a.id, message: "Changed" }],
    }),
    { code: "conflict" },
  );
  const before = await engine.tasks.get(undefined, {
    batch_id: first.batch_id,
    wait_ms: 5,
  });
  assert.equal(before.complete, false);
  gate.resolve();
  await until(() => idle(engine));
  assert.equal(seen.length, 3);
  assert.ok(engine.tasks.tasks.every((task) => task.status === "done"));
  assert.equal(engine.tasks.batches[0].notification, "query_only");
});

test("failed admission never launches; restart preserves queued but never replays a running task", async (t) => {
  const { store, engine, a, dir } = await fixture(t);
  const original = store.save.bind(store);
  let calls = 0;
  engine.agent = {
    async run(input, options) {
      calls++;
      return agentResult(input, options);
    },
  };
  store.save = async () => {
    throw new Error("disk full");
  };
  await assert.rejects(
    engine.tasks.dispatch(undefined, {
      request_id: "save",
      tasks: [{ to: a.id, message: "Work" }],
    }),
    /disk full/,
  );
  assert.equal(calls, 0);
  assert.equal(engine.tasks.tasks.length, 0);
  store.save = original;
  engine.tasks.disposed = true;
  await engine.tasks.dispatch(undefined, {
    request_id: "restart",
    tasks: [
      { to: a.id, message: "First" },
      { to: a.id, message: "Second" },
    ],
  });
  engine.tasks.tasks[0].status = "running";
  engine.tasks.batches[0].notification = "delivering";
  await store.save();
  const restored = new Store(dir);
  await restored.init();
  assert.deepEqual(
    restored.state.taskBatches[0].tasks.map((task) => task.status),
    ["unknown", "queued"],
  );
  assert.equal(restored.state.taskBatches[0].notification, "unknown");
});

test("cancel stops queued/running work and unknown outcomes remain queryable without replay", async (t) => {
  const { engine, a, b } = await fixture(t);
  let count = 0;
  engine.agent = {
    async run(input, options) {
      const result = agentResult(input, options);
      count++;
      await new Promise((resolve) =>
        options.signal.addEventListener("abort", resolve, { once: true }),
      );
      return { ...result, status: "aborted" };
    },
  };
  const receipt = await engine.tasks.dispatch(undefined, {
    request_id: "cancel",
    tasks: [
      { to: a.id, message: "One" },
      { to: a.id, message: "Two" },
      { to: b.id, message: "Three" },
    ],
  });
  await until(() => count === 2);
  await engine.tasks.cancel(undefined, { batch_id: receipt.batch_id });
  await until(() => idle(engine));
  assert.deepEqual(
    engine.tasks.tasks.map((task) => task.status),
    ["cancelled", "cancelled", "cancelled"],
  );
  assert.equal(count, 2);
  engine.agent = {
    async run(input, options) {
      agentResult(input, options);
      throw Object.assign(new Error("connection lost"), {
        code: "AGENT_OUTCOME_UNKNOWN",
      });
    },
  };
  const unknown = await engine.tasks.dispatch(undefined, {
    request_id: "lost",
    tasks: [{ to: a.id, message: "Write" }],
  });
  await until(() => idle(engine));
  assert.equal(
    (await engine.tasks.get(undefined, { batch_id: unknown.batch_id })).tasks[0]
      .status,
    "unknown",
  );
  assert.equal(
    (
      await engine.tasks.dispatch(undefined, {
        request_id: "lost",
        tasks: [{ to: a.id, message: "Write" }],
      })
    ).batch_id,
    unknown.batch_id,
  );
});

test("task waiting for an answer is incomplete, continuation settles the same task, cancellation blocks stale answers", async (t) => {
  const { store, engine, a } = await fixture(t);
  engine.agent = {
    async run(input, options) {
      return agentResult(input, options, "Question", {
        pendingQuestion: {
          requestId: "question",
          mode: "questionnaire",
          request: { schemaVersion: 2, id: "question", steps: [] },
        },
      });
    },
    async answer(input, options) {
      return agentResult(input, options, "Answered");
    },
  };
  const receipt = await engine.tasks.dispatch(undefined, {
    request_id: "answer",
    tasks: [{ to: a.id, message: "Ask" }],
  });
  await until(() => idle(engine));
  const task = engine.tasks.tasks[0];
  assert.equal(task.status, "waiting_for_user");
  assert.equal(
    (await engine.tasks.get(undefined, { batch_id: receipt.batch_id }))
      .complete,
    false,
  );
  await engine.answerQuestion(task.chatId, task.messageId, []);
  await until(() => idle(engine));
  assert.equal(task.status, "done");
  await engine.tasks.dispatch(undefined, {
    request_id: "stale",
    tasks: [{ to: a.id, message: "Ask again" }],
  });
  await until(() => idle(engine));
  const stale = engine.tasks.tasks[1];
  await engine.tasks.cancel(undefined, { task_id: stale.id });
  await assert.rejects(
    engine.answerQuestion(stale.chatId, stale.messageId, []),
    { code: "invalid" },
  );
});

test("a group can progress beyond eight replies, while repeated handoffs wait for a normal follow-up message", async (t) => {
  const { engine, group, a, b } = await fixture(t);
  let turns = 0;
  engine.agent = {
    async run(input, options) {
      turns++;
      return agentResult(
        input,
        options,
        turns < 11
          ? `${turns}: @${turns % 2 ? b.name : a.name} continue`
          : "All eleven steps complete",
      );
    },
  };
  await engine.tasks.dispatch(
    undefined,
    { request_id: "eleven", group: group.id, message: "Discuss" },
    undefined,
    true,
  );
  await until(() => idle(engine));
  assert.equal(turns, 11);
  assert.equal(engine.tasks.tasks[0].status, "done");
  engine.agent = {
    async run(input, options) {
      const alice = input.text.includes("It's your turn (Alice).");
      return agentResult(
        input,
        options,
        alice ? "@Bob continue" : "@Alice continue",
      );
    },
  };
  const receipt = await engine.tasks.dispatch(
    undefined,
    { request_id: "loop", group: group.id, message: "Discuss" },
    undefined,
    true,
  );
  await until(() => idle(engine));
  const task = engine.tasks.tasks[1];
  assert.equal(task.status, "paused");
  assert.equal(task.pauseReason, "no_progress");
  engine.agent = {
    async run(input, options) {
      return agentResult(input, options, "Resolved");
    },
  };
  await engine.sendUserMessage(`group:${group.id}`, "Continue and finish the result");
  await until(() => task.status === "done" && idle(engine) && !engine.inbox.batches.size);
  assert.equal(task.status, "done");
});

test("task results return to their source chat once without copying private history; source cancellation leaves workers running", async (t) => {
  const { store, engine, a, b, group } = await fixture(t);
  const gate = deferred();
  let receipt;
  let summaries = 0;
  await store.appendMessage(`bot:${b.id}`, {
    role: "user",
    text: "PRIVATE_HISTORY_NOT_TO_FORWARD",
  });
  engine.agent = {
    async run(input, options) {
      const result = agentResult(input, options);
      if (input.text.endsWith("Dispatch now")) {
        const turn = engine.bindCallerTurn(a.id);
        receipt = await engine.tasks.dispatch(
          a,
          {
            request_id: "return",
            tasks: [{ to: b.id, message: "Review" }],
          },
          { turn },
        );
      } else if (input.text.endsWith("Review")) {
        await gate.promise;
        result.text = "REVIEW_OUTPUT";
      } else {
        summaries++;
        assert.ok(!input.text.includes("PRIVATE_HISTORY_NOT_TO_FORWARD"));
      }
      return result;
    },
  };
  t.after(() => gate.resolve());
  await engine.runBotTurn({
    bot: a,
    chatId: `bot:${a.id}`,
    kind: "private",
    text: "Dispatch now",
  });
  engine.cancelChat(`bot:${a.id}`);
  assert.ok(!engine.tasks.tasks[0].cancelRequested);
  gate.resolve();
  await until(() => idle(engine));
  assert.equal(summaries, 1);
  const messages = await store.getMessages(`bot:${a.id}`);
  const reports = messages.filter(
    (message) => message.taskBatchId === receipt.batch_id,
  );
  assert.equal(reports.length, 1);
  assert.match(reports[0].text, /REVIEW_OUTPUT/);
  assert.doesNotMatch(reports[0].text, /PRIVATE_HISTORY/);
  await engine.tasks.deliver(engine.tasks.batches[0]);
  assert.equal(summaries, 1);
});

test("group questionnaire preserves pending members and a new user input pauses rather than completes the discussion", async (t) => {
  const { engine, group } = await fixture(t);
  group.replyMode = "all";
  let runs = 0;
  engine.agent = {
    async run(input, options) {
      runs++;
      return agentResult(
        input,
        options,
        "Choose",
        runs === 1
          ? {
              pendingQuestion: {
                requestId: "question",
                mode: "questionnaire",
                request: { schemaVersion: 2, id: "question", steps: [] },
              },
            }
          : {},
      );
    },
    async answer(input, options) {
      return agentResult(input, options, "Answered");
    },
  };
  await engine.tasks.dispatch(
    undefined,
    { request_id: "members", group: group.id, message: "Discuss" },
    undefined,
    true,
  );
  await until(() => idle(engine));
  const task = engine.tasks.tasks[0];
  assert.equal(task.status, "waiting_for_user");
  assert.equal(task.remaining.length, 1);
  await engine.answerQuestion(task.chatId, task.messageId, []);
  await until(() => idle(engine));
  assert.equal(task.status, "done");
  assert.equal(runs, 2);
  const entered = deferred();
  engine.agent = {
    async run(input, options) {
      const result = agentResult(input, options);
      entered.resolve();
      await new Promise((resolve) =>
        options.signal.addEventListener("abort", resolve, { once: true }),
      );
      return { ...result, status: "aborted" };
    },
  };
  await engine.tasks.dispatch(
    undefined,
    { request_id: "interrupt", group: group.id, message: "Discuss" },
    undefined,
    true,
  );
  await entered.promise;
  const loop = engine.groupLoops.get(`group:${group.id}`);
  loop.cancelled = true;
  for (const ticket of engine.tickets) ticket.controller.abort();
  await until(() => idle(engine));
  assert.equal(engine.tasks.tasks[1].status, "paused");
  assert.equal(engine.tasks.tasks[1].pauseReason, "interrupted");
});

test("full result pagination and ownership remain available after completion", async (t) => {
  const { engine, a, b } = await fixture(t);
  const output = "Long result ".repeat(1800);
  engine.agent = {
    async run(input, options) {
      return agentResult(input, options, output);
    },
  };
  const receipt = await engine.tasks.dispatch(undefined, {
    request_id: "long",
    tasks: [{ to: a.id, message: "Write" }],
  });
  await until(() => idle(engine));
  let offset = 0,
    text = "";
  do {
    const page = (
      await engine.tasks.get(undefined, {
        task_id: receipt.tasks[0].task_id,
        result_offset: offset,
      })
    ).tasks[0];
    text += page.result;
    offset = page.next_result_offset;
  } while (offset !== null);
  assert.equal(text, output.trim());
  await assert.rejects(engine.tasks.get(b, { batch_id: receipt.batch_id }), {
    code: "forbidden",
  });
});

test("cancelling a questionnaire continuation aborts the same task rather than leaving work running", async (t) => {
  const { engine, a } = await fixture(t);
  const entered = deferred();
  let aborted = false;
  engine.agent = {
    async run(input, options) {
      return agentResult(input, options, "Choose", {
        pendingQuestion: {
          requestId: "question",
          mode: "questionnaire",
          request: { schemaVersion: 2, id: "question", steps: [] },
        },
      });
    },
    async answer(input, options) {
      const result = agentResult(input, options);
      entered.resolve();
      await new Promise((resolve) =>
        options.signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            resolve();
          },
          { once: true },
        ),
      );
      return { ...result, status: "aborted" };
    },
  };
  await engine.tasks.dispatch(undefined, {
    request_id: "answer-stop",
    tasks: [{ to: a.id, message: "Choose" }],
  });
  await until(() => idle(engine));
  const task = engine.tasks.tasks[0];
  await engine.answerQuestion(task.chatId, task.messageId, []);
  await entered.promise;
  await engine.tasks.cancel(undefined, { task_id: task.id });
  await until(() => idle(engine));
  assert.equal(aborted, true);
  assert.equal(task.status, "cancelled");
});

test('busy private chats stay queued without consuming task workers and can be cancelled immediately', async (t) => {
  const { engine, a, b } = await fixture(t);
  const gate = deferred(); t.after(() => gate.resolve());
  const runs = [];
  engine.agent = { async run(input, options) {
    runs.push(input.text); const result = agentResult(input, options);
    if (input.text.endsWith('Busy chat')) await gate.promise;
    return result;
  } };
  const busy = engine.runBotTurn({ bot: a, chatId: `bot:${a.id}`, kind: 'private', text: 'Busy chat' });
  await until(() => runs.length === 1);
  const receipt = await engine.tasks.dispatch(undefined, { request_id: 'busy-target', tasks: [{ to: a.id, message: 'Queued task' }, { to: b.id, message: 'Independent task' }] });
  await until(() => engine.tasks.tasks[1].status === 'done');
  assert.equal(engine.tasks.tasks[0].status, 'queued');
  await engine.tasks.cancel(undefined, { task_id: receipt.tasks[0].task_id });
  assert.equal(engine.tasks.tasks[0].status, 'cancelled');
  gate.resolve(); await busy; await until(() => idle(engine));
  assert.ok(!runs.some((text) => text.endsWith('Queued task')));
});

test('a task queued behind its caller starts when that private turn releases its chat', async (t) => {
  const { engine, a } = await fixture(t);
  let calls = 0;
  engine.agent = { async run(input, options) {
    calls++; const result = agentResult(input, options);
    if (calls === 1) await engine.tasks.dispatch(a, { request_id: 'after-caller', tasks: [{ to: a.id, message: 'Follow-up' }] }, { turn: engine.bindCallerTurn(a.id) });
    return result;
  } };
  await engine.runBotTurn({ bot: a, chatId: `bot:${a.id}`, kind: 'private', text: 'Dispatch' });
  await until(() => engine.tasks.tasks[0].status === 'done' && idle(engine));
  assert.equal(calls, 3); // caller, task, one result summary
});

for (const dependencyKind of ["helper", "batch"]) {
  test(`${dependencyKind} output is verified under the parent task before its single source-chat delivery`, async (t) => {
    const { engine, store, a, b, group } = await fixture(t);
    const gate = deferred();
    t.after(() => gate.resolve());
    let dependencyStarted = false;
    let receipt;
    let reviews = 0;
    engine.agent = { async run(input, options) {
      const result = agentResult(input, options);
      if (input.text.endsWith("Dispatch from group")) {
        receipt = await engine.tasks.dispatch(b, { request_id: "parent", tasks: [{ to: a.id, message: "Parent request" }] }, { turn: engine.bindCallerTurn(b.id) });
        return result;
      }
      if (input.text.endsWith("Parent request")) {
        const invocation = { turn: engine.bindCallerTurn(a.id) };
        if (dependencyKind === "helper") await engine.startHelper(a, { task: "Child work" }, invocation);
        else await engine.tasks.dispatch(a, { request_id: "child", tasks: [{ to: b.id, message: "Child work" }] }, invocation);
        return { ...result, text: "Only acknowledged" };
      }
      if (input.text.endsWith("Child work")) {
        dependencyStarted = true;
        await gate.promise;
        return { ...result, text: "Produced deliverable" };
      }
      if (input.text.includes("These are dependency results")) {
        reviews++;
        assert.match(input.text, /Produced deliverable/);
        assert.equal(engine.bindCallerTurn(a.id).message.taskId, engine.tasks.tasks[0].id);
        return { ...result, text: "Verified final deliverable" };
      }
      assert.match(input.text, /Verified final deliverable/);
      return { ...result, text: "Final group summary" };
    } };
    await engine.runBotTurn({ bot: b, chatId: `group:${group.id}`, kind: "group", text: "Dispatch from group" });
    const parent = engine.tasks.task(receipt.tasks[0].task_id);
    await until(() => dependencyStarted && parent.status === "waiting_for_tasks" && !engine.tasks.runs.has(parent.id));
    assert.equal((await engine.tasks.get(undefined, { task_id: parent.id })).complete, false);
    assert.ok(!(await store.getMessages(`group:${group.id}`)).some((message) => message.taskBatchId));
    gate.resolve();
    await until(() => engine.tasks.batches[0].notification === "delivered" && idle(engine));
    assert.equal(parent.status, "done");
    assert.equal(parent.result, "Verified final deliverable");
    assert.equal(reviews, 1);
    const reports = (await store.getMessages(`group:${group.id}`)).filter((message) => message.taskBatchId === receipt.batch_id);
    assert.equal(reports.length, 1);
    assert.match(reports[0].text, /Verified final deliverable/);
    assert.doesNotMatch(reports[0].text, /Only acknowledged/);
  });

  test(`cancelling a waiting parent aborts its ${dependencyKind} and never starts verification`, async (t) => {
    const { engine, a, b } = await fixture(t);
    let childSignal;
    let reviews = 0;
    engine.agent = { async run(input, options) {
      const result = agentResult(input, options);
      if (input.text.endsWith("Parent request")) {
        const invocation = { turn: engine.bindCallerTurn(a.id) };
        if (dependencyKind === "helper") await engine.startHelper(a, { task: "Child work" }, invocation);
        else await engine.tasks.dispatch(a, { request_id: "child", tasks: [{ to: b.id, message: "Child work" }] }, invocation);
        return result;
      }
      if (input.text.endsWith("Child work")) {
        childSignal = options.signal;
        await new Promise((resolve) => options.signal.addEventListener("abort", resolve, { once: true }));
        return { ...result, status: "aborted" };
      }
      reviews++;
      return result;
    } };
    await engine.tasks.dispatch(undefined, { request_id: "parent", tasks: [{ to: a.id, message: "Parent request" }] });
    const parent = engine.tasks.tasks[0];
    await until(() => childSignal && parent.status === "waiting_for_tasks");
    await engine.tasks.cancel(undefined, { task_id: parent.id });
    await until(() => !engine.helperRuns.size && idle(engine));
    assert.equal(childSignal.aborted, true);
    assert.equal(parent.status, "cancelled");
    assert.equal(reviews, 0);
  });
}

test("a group waits for helper verification before handing off to the remaining member", async (t) => {
  const { engine, a, b, group } = await fixture(t);
  group.replyMode = "all";
  const gate = deferred();
  t.after(() => gate.resolve());
  const speakers = [];
  let dispatched = false;
  engine.agent = { async run(input, options) {
    const result = agentResult(input, options);
    if (input.text.includes("<minimax-bot-helper>")) {
      await gate.promise;
      return { ...result, text: "Research output" };
    }
    const turn = [...engine.running.values()][0];
    speakers.push(turn.botId);
    if (!dispatched) {
      dispatched = true;
      await engine.startHelper(a, { task: "Research" }, { turn });
      return { ...result, text: "Working on it" };
    }
    if (turn.botId === a.id) {
      assert.match(input.text, /Research output/);
      return { ...result, text: "Verified research @Bob" };
    }
    assert.match(input.text, /Verified research/);
    return { ...result, text: "Group finished" };
  } };
  await engine.tasks.dispatch(undefined, { request_id: "group-helper", group: group.id, message: "Discuss" }, undefined, true);
  const task = engine.tasks.tasks[0];
  await until(() => task.status === "waiting_for_tasks" && !engine.tasks.runs.size);
  assert.deepEqual(speakers, [a.id]);
  gate.resolve();
  await until(() => task.status === "done" && idle(engine));
  assert.deepEqual(speakers, [a.id, a.id, b.id]);
  assert.equal(task.result, "Group finished");
});

test("multiple dependencies are verified together and verification can delegate another round", async (t) => {
  const { engine, a, b } = await fixture(t);
  const first = deferred();
  const second = deferred();
  t.after(() => { first.resolve(); second.resolve(); });
  let reviews = 0;
  engine.agent = { async run(input, options) {
    const result = agentResult(input, options);
    if (input.text.endsWith("Parent request")) {
      await engine.startHelper(a, { task: "First output" }, { turn: engine.bindCallerTurn(a.id) });
      await engine.tasks.dispatch(a, { request_id: "second", tasks: [{ to: b.id, message: "Second output" }] }, { turn: engine.bindCallerTurn(a.id) });
      return result;
    }
    if (input.text.endsWith("First output")) { await first.promise; return { ...result, text: "First evidence" }; }
    if (input.text.endsWith("Second output")) { await second.promise; return { ...result, text: "Second evidence" }; }
    if (input.text.endsWith("Additional check")) return { ...result, text: "Checked" };
    reviews++;
    if (reviews === 1) {
      assert.match(input.text, /First evidence/);
      assert.match(input.text, /Second evidence/);
      await engine.startHelper(a, { task: "Additional check" }, { turn: engine.bindCallerTurn(a.id) });
      return { ...result, text: "Need one more check" };
    }
    assert.match(input.text, /Checked/);
    return { ...result, text: "All verified" };
  } };
  await engine.tasks.dispatch(undefined, { request_id: "parent", tasks: [{ to: a.id, message: "Parent request" }] });
  const task = engine.tasks.tasks[0];
  await until(() => task.status === "waiting_for_tasks");
  first.resolve();
  await until(() => engine.store.state.helpers[0].status === "done");
  assert.equal(task.status, "waiting_for_tasks");
  assert.equal(reviews, 0);
  second.resolve();
  await until(() => task.status === "done" && idle(engine));
  assert.equal(reviews, 2);
  assert.equal(task.result, "All verified");
});

test("cancelling the parent's verification aborts its continuation and prevents a done result", async (t) => {
  const { engine, a } = await fixture(t);
  let verifying;
  engine.agent = { async run(input, options) {
    const result = agentResult(input, options);
    if (input.text.endsWith("Parent request")) {
      await engine.startHelper(a, { task: "Research" }, { turn: engine.bindCallerTurn(a.id) });
      return result;
    }
    if (input.text.includes("<minimax-bot-helper>")) return { ...result, text: "Evidence" };
    verifying = options.signal;
    await new Promise((resolve) => verifying.addEventListener("abort", resolve, { once: true }));
    return { ...result, status: "aborted" };
  } };
  await engine.tasks.dispatch(undefined, { request_id: "parent", tasks: [{ to: a.id, message: "Parent request" }] });
  await until(() => verifying);
  const task = engine.tasks.tasks[0];
  await engine.tasks.cancel(undefined, { task_id: task.id });
  await until(() => idle(engine));
  assert.equal(verifying.aborted, true);
  assert.equal(task.status, "cancelled");
});

test("restart verifies persisted dependency outputs once but never replays an interrupted dependency", async (t) => {
  const { engine, store, a, dir } = await fixture(t);
  store.state.helpers.push(
    { id: "helper_ready", botId: a.id, chatId: `bot:${a.id}`, title: "Research", status: "done", report: "Saved evidence" },
    { id: "helper_lost", botId: a.id, chatId: `bot:${a.id}`, title: "Lost research", status: "running" },
  );
  store.state.taskBatches.push(...["ready", "lost"].map((kind) => ({
    id: `batch_${kind}`, notification: "pending", tasks: [{ id: `task_${kind}`, kind: "bot", botId: a.id,
      chatId: `bot:${a.id}`, text: "Original request", title: "Research", status: "waiting_for_tasks",
      dependencies: [{ kind: "helper", id: `helper_${kind}`, botId: a.id }],
    }],
  })));
  await store.save();
  const recoveredStore = new Store(dir);
  await recoveredStore.init();
  let runs = 0;
  const recovered = new Engine({ store: recoveredStore, memory: engine.memory, logger: { warn() {} }, broadcast() {}, retryDelaysMs: [],
    agent: { async run(input, options) {
      runs++;
      assert.match(input.text, /Saved evidence/);
      return agentResult(input, options, "Verified recovered evidence");
    } },
  });
  t.after(() => recovered.dispose());
  recovered.tasks.start();
  await until(() => recovered.tasks.task("task_ready").status === "done" && idle(recovered));
  assert.equal(recovered.tasks.task("task_lost").status, "unknown");
  recovered.tasks.start();
  await until(() => idle(recovered));
  assert.equal(runs, 1);
  assert.equal(recovered.tasks.task("task_ready").result, "Verified recovered evidence");
  await recoveredStore.writeChain;
});

test("message_bot queues both short and long work durably, deduplicates retries and returns output to the source chat", async (t) => {
  const { engine, store, a, b, rpc } = await fixture(t);
  const busy = deferred();
  t.after(() => busy.resolve());
  let busyStarted = false;
  const receipts = [];
  let executions = 0;
  engine.agent = { async run(input, options) {
    const result = agentResult(input, options);
    if (input.text.endsWith("Busy private chat")) { busyStarted = true; await busy.promise; return result; }
    if (input.text.endsWith("Please delegate")) {
      for (let i = 0; i < 2; i++) {
        const response = await rpc("message_bot", { caller_bot_id: a.id, request_id: "same-request", to: b.id, message: "Work of any length" });
        assert.notEqual(response.isError, true);
        receipts.push(JSON.parse(response.content[0].text));
      }
      return { ...result, text: "I will handle it" };
    }
    if (input.text.endsWith("Work of any length")) { executions++; return { ...result, text: "Delivered work" }; }
    assert.match(input.text, /Delivered work/);
    return { ...result, text: "Here is your result" };
  } };
  const running = engine.runBotTurn({ bot: b, chatId: `bot:${b.id}`, kind: "private", text: "Busy private chat" });
  await until(() => busyStarted);
  await engine.runBotTurn({ bot: a, chatId: `bot:${a.id}`, kind: "private", text: "Please delegate" });
  assert.equal(receipts[0].tasks[0].status, "queued");
  assert.equal(receipts[0].batch_id, receipts[1].batch_id);
  assert.equal(executions, 0);
  busy.resolve();
  await running;
  await until(() => engine.tasks.batches[0].notification === "delivered" && idle(engine));
  assert.equal(executions, 1);
  assert.ok((await store.getMessages(`bot:${a.id}`)).some((message) => message.text === "Here is your result"));
});

test("post_group accepts ordinary follow-up instructions for a paused discussion and deduplicates that continuation", async (t) => {
  const { engine, store, group } = await fixture(t);
  engine.agent = { async run(input, options) {
    const alice = input.text.includes("It's your turn (Alice).");
    return agentResult(input, options, alice ? "@Bob continue" : "@Alice continue");
  } };
  const first = await engine.tasks.dispatch(undefined, { request_id: "original", group: group.id, message: "Discuss" }, undefined, true);
  await until(() => idle(engine));
  assert.equal(engine.tasks.tasks[0].status, "paused");
  const gate = deferred();
  t.after(() => gate.resolve());
  let runs = 0;
  engine.agent = { async run(input, options) {
    runs++;
    assert.match(input.text, /Finish with a conclusion/);
    const result = agentResult(input, options, "Concluded");
    await gate.promise;
    return result;
  } };
  const args = { request_id: "continue", group: group.id, message: "Finish with a conclusion" };
  const next = await engine.tasks.dispatch(undefined, args, undefined, true);
  const retry = await engine.tasks.dispatch(undefined, args, undefined, true);
  assert.equal(next.batch_id, first.batch_id);
  assert.equal(retry.batch_id, first.batch_id);
  await assert.rejects(engine.tasks.dispatch(undefined, { ...args, message: "Different" }, undefined, true), { code: "conflict" });
  gate.resolve();
  await until(() => idle(engine));
  assert.equal(engine.tasks.tasks.length, 1);
  assert.equal(engine.tasks.tasks[0].status, "done");
  assert.ok(runs >= 1);
  assert.equal((await store.getMessages(`group:${group.id}`)).filter((message) => message.role === "relay" && message.text === args.message).length, 1);
});

for (const stopWhileSettling of [false, true]) {
  test(stopWhileSettling ? "stopping while a group supplement waits for settlement prevents all continuation" : "ordinary group input safely interrupts dependency verification and keeps the original task", async (t) => {
  const { engine, store, a, group } = await fixture(t);
  group.replyMode = "all";
  let first = true;
  let verifying;
  let reviews = 0;
  const calls = [];
  let continuing = false;
  const continueDiscussion = engine.tasks.continueDiscussion.bind(engine.tasks);
  engine.tasks.continueDiscussion = (...args) => { continuing = true; return continueDiscussion(...args); };
  const settling = deferred();
  t.after(() => settling.resolve());
  const save = engine.tasks.save.bind(engine.tasks);
  engine.tasks.save = async () => {
    await save();
    if (engine.tasks.tasks[0]?.pauseReason === "interrupted") await settling.promise;
  };
  engine.agent = { async run(input, options) {
    const result = agentResult(input, options);
    if (input.text.includes("<minimax-bot-helper>")) return { ...result, text: "Evidence" };
    const turn = [...engine.running.values()][0];
    calls.push({ kind: turn.message.kind, taskId: turn.message.taskId });
    if (first) {
      first = false;
      await engine.startHelper(a, { task: "Research" }, { turn });
      return { ...result, text: "Wait for evidence" };
    }
    if (turn.message.kind === "task_review") {
      reviews++;
      if (reviews === 1) {
        verifying = options.signal;
        await new Promise((resolve) => verifying.addEventListener("abort", resolve, { once: true }));
        return { ...result, status: "aborted" };
      }
      assert.match(input.text, /Evidence/);
      assert.match(input.text, /Add requirement and finish/);
    }
    return { ...result, text: "Finished following user supplement" };
  } };
  await engine.tasks.dispatch(undefined, { request_id: "review-interrupt", group: group.id, message: "Discuss" }, undefined, true);
  await until(() => verifying);
  const task = engine.tasks.tasks[0];
  await engine.sendUserMessage(`group:${group.id}`, "Add requirement and finish");
  await until(() => task.status === "paused");
  assert.equal(reviews, 1);
  assert.ok(task.review);
  await until(() => continuing);
  if (stopWhileSettling) engine.cancelChat(task.chatId);
  settling.resolve();
  await until(() => idle(engine) && !engine.inbox.batches.size);
  if (stopWhileSettling) {
    assert.equal(task.status, "cancelled");
    assert.equal(reviews, 1);
    assert.equal(calls.length, 2);
    return;
  }
  assert.equal(task.status, "done");
  assert.equal(task.result, "Finished following user supplement");
  assert.equal(reviews, 2);
  assert.ok(calls.every((call) => call.taskId === task.id));
  assert.ok((await store.getMessages(task.chatId)).some((message) => message.botId === "bot_b" && message.taskId === task.id && message.status === "done"));
  });
}

for (const continuation of ["questionnaire", "dependency verification"]) {
  test(`restart after ${continuation} preserves the next group member before publishing completion`, async (t) => {
    const { engine, store, a, b, group, dir } = await fixture(t);
    group.replyMode = "all";
    const helper = deferred();
    t.after(() => helper.resolve());
    let first = true;
    engine.agent = {
      async run(input, options) {
        const result = agentResult(input, options);
        if (input.text.includes("<minimax-bot-helper>")) { await helper.promise; return { ...result, text: "Evidence" }; }
        if (first) {
          first = false;
          if (continuation === "questionnaire") return { ...result, text: "Choose", pendingQuestion: {
            requestId: "question", mode: "questionnaire", request: { schemaVersion: 2, id: "question", steps: [] },
          } };
          await engine.startHelper(a, { task: "Research" }, { turn: engine.bindCallerTurn(a.id) });
          return { ...result, text: "Wait for evidence" };
        }
        return { ...result, text: "Verified" };
      },
      async answer(input, options) { return agentResult(input, options, "Answer accepted"); },
    };
    await engine.tasks.dispatch(undefined, { request_id: "crash", group: group.id, message: "Discuss" }, undefined, true);
    const task = engine.tasks.tasks[0];
    await until(() => ["waiting_for_user", "waiting_for_tasks"].includes(task.status) && !engine.tasks.runs.size);
    const save = engine.tasks.save.bind(engine.tasks);
    let snapshot;
    engine.tasks.save = async () => {
      await save();
      if (!snapshot && ["done", "queued"].includes(task.status)) {
        // Stop before the next member begins; restart from the first settled write.
        engine.tasks.pump = () => {};
        snapshot = JSON.parse(await readFile(store.statePath, "utf8"));
      }
    };
    if (continuation === "questionnaire") await engine.answerQuestion(task.chatId, task.messageId, []);
    else helper.resolve();
    await until(() => snapshot && idle(engine));
    const savedTask = snapshot.taskBatches[0].tasks[0];
    assert.equal(savedTask.status, "queued");
    assert.deepEqual(savedTask.remaining, [b.id]);
    assert.equal(snapshot.taskBatches[0].notification, "pending");
    engine.dispose();
    const recoveredStore = new Store(dir);
    await recoveredStore.init();
    let recoveryCalls = 0;
    const recovered = new Engine({ store: recoveredStore, memory: engine.memory, logger: { warn() {} }, broadcast() {}, retryDelaysMs: [],
      agent: { async run(input, options) {
        recoveryCalls++;
        assert.match(input.text, /It's your turn \(Bob\)/);
        return agentResult(input, options, "Remaining member done");
      } },
    });
    t.after(() => recovered.dispose());
    recovered.tasks.start();
    await until(() => recovered.tasks.task(task.id).status === "done" && idle(recovered));
    assert.equal(recoveryCalls, 1);
    assert.equal(recovered.tasks.task(task.id).result, "Remaining member done");
    await recoveredStore.writeChain;
  });
}

test("a discussion in which every member passes finishes as done with an empty result", async (t) => {
  const { engine, store, group } = await fixture(t);
  // Every member that is called has nothing to add.
  engine.agent = { async run(input, options) { return agentResult(input, options, "[PASS]"); } };

  await engine.tasks.dispatch(undefined, { request_id: "all-pass", group: group.id, message: "Anything to add?" }, undefined, true);
  await until(() => idle(engine));

  const task = engine.tasks.tasks[0];
  // The round ran to the end: nothing was cancelled, and no work is left waiting.
  assert.equal(task.status, "done", `task ended as ${task.status}`);
  assert.equal(task.result, "");
  assert.equal(task.error, undefined);
  assert.equal(task.remainder?.length ?? 0, 0);
  // The passes themselves are still recorded, and still marked as such.
  const passes = (await store.getMessages(`group:${group.id}`)).filter((message) => message.status === "pass");
  assert.ok(passes.length >= 1, "the member's pass is still in the chat, marked as a pass");
  assert.ok(passes.every((message) => /^\s*\[?PASS\]?\s*[.。]?\s*$/i.test(message.text)));
});

test("a report that had to shorten a result says so", async (t) => {
  const { engine } = await fixture(t);
  const long = "x".repeat(9000);
  const batch = {
    id: "batch_clip",
    tasks: [
      // Longer than the report window and already shortened in the record: both are silent cuts.
      { id: "task_long", botId: "bot_b", status: "done", result: long.slice(0, 8000), resultTruncated: true },
      // Longer than the report window only.
      { id: "task_window", botId: "bot_b", status: "done", result: long.slice(0, 5000) },
      // Short enough: nothing was cut, so nothing is said.
      { id: "task_short", botId: "bot_b", status: "done", result: "All good" },
    ],
  };

  const report = engine.tasks.batchReport(batch);
  const [longPart, windowPart, shortPart] = report.split("\n\n");

  assert.ok(longPart.includes("(truncated)"), "a result shortened in the record says so");
  assert.ok(windowPart.includes("(truncated)"), "a result longer than the report window says so");
  assert.ok(!shortPart.includes("(truncated)"), "a result that fits is not marked");
  assert.ok(shortPart.includes("All good"), "a short result is still shown in full");
});
