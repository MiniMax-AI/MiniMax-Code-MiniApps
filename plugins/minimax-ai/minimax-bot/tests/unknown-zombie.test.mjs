import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../miniapp/node/store.mjs";
import { MemoryStore } from "../miniapp/node/memory.mjs";
import { Engine } from "../miniapp/node/engine.mjs";
import { setLocale, t as tr } from "../miniapp/node/i18n.mjs";

async function until(predicate, label = "condition") {
  for (let i = 0; i < 800; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const idle = (engine) =>
  !engine.tasks.runs.size &&
  !engine.tasks.deliveries.size &&
  !engine.tickets.size;

const unknownOutcome = () =>
  Object.assign(new Error("The Agent turn failed"), {
    code: "AGENT_OUTCOME_UNKNOWN",
  });

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "bot-unknown-"));
  const store = new Store(dir);
  await store.init();
  const memory = new MemoryStore(dir);
  await memory.init();
  setLocale("en");
  const a = { id: "bot_a", name: "Alice", isMain: true };
  const b = { id: "bot_b", name: "Bob" };
  store.state.bots = [a, b];
  await store.save();
  const engine = new Engine({
    store,
    memory,
    logger: { warn() {} },
    broadcast() {},
    retryDelaysMs: [],
  });
  t.after(async () => {
    engine.dispose();
    await until(() => idle(engine), "idle").catch(() => {});
    await store.writeChain;
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, store, memory, engine, a, b };
}

test("an unconfirmed outcome closes its batch, reaches the user and is never replayed", async (t) => {
  const { store, engine, a } = await fixture(t);
  let turns = 0;
  engine.agent = {
    async run(input, options) {
      turns++;
      options.onEvent({ type: "turn.started", sessionId: `t-${turns}` });
      throw unknownOutcome();
    },
  };
  const receipt = await engine.tasks.dispatch(
    undefined,
    { request_id: "unknown", tasks: [{ to: a.id, message: "Write the summary" }] },
    { turn: { chatId: `bot:${a.id}` } },
  );
  await until(() => idle(engine), "idle");
  await until(
    () => engine.tasks.batches[0].notification !== "pending",
    "batch delivery",
  );
  const batch = engine.tasks.batches.find((item) => item.id === receipt.batch_id);
  assert.equal(batch.tasks[0].status, "unknown");
  // The batch converged instead of waiting for a task that can never make progress.
  assert.notEqual(batch.notification, "pending");
  assert.equal(engine.tasks.view(batch).complete, true);
  // The user is told what happened instead of getting nothing.
  const reports = (await store.getMessages(`bot:${a.id}`)).filter(
    (message) => message.taskBatchId === batch.id,
  );
  assert.equal(reports.length, 1);
  assert.ok(reports[0].text.includes(tr("task.unknownOutcome")));
  // An unconfirmed outcome is never replayed on its own.
  assert.equal(turns, 1);
});

test("a task left running by a crash converges after the restart", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "bot-unknown-restart-"));
  const store = new Store(dir);
  await store.init();
  const memory = new MemoryStore(dir);
  await memory.init();
  setLocale("en");
  const a = { id: "bot_a", name: "Alice", isMain: true };
  store.state.bots = [a];
  await store.save();
  const engine = new Engine({
    store,
    memory,
    logger: { warn() {} },
    broadcast() {},
    retryDelaysMs: [],
  });
  // A turn that never finishes: the process dies with the task still running.
  engine.agent = {
    async run(input, options) {
      options.onEvent({ type: "turn.started", sessionId: "s1" });
      await new Promise(() => {});
    },
  };
  await engine.tasks.dispatch(
    undefined,
    { request_id: "crash", tasks: [{ to: a.id, message: "Work" }] },
    { turn: { chatId: `bot:${a.id}` } },
  );
  await until(() => engine.tasks.tasks[0]?.status === "running", "running task");
  await store.writeChain;
  const persisted = JSON.parse(await readFile(join(dir, "state.json"), "utf8"));
  assert.equal(persisted.taskBatches[0].tasks[0].status, "running");
  t.after(async () => {
    engine.dispose();
    await rm(dir, { recursive: true, force: true });
  });

  // Restart: the interrupted task becomes unknown and must not stay stuck.
  const restored = new Store(dir);
  await restored.init();
  assert.equal(restored.state.taskBatches[0].tasks[0].status, "unknown");
  const restarted = new Engine({
    store: restored,
    memory,
    logger: { warn() {} },
    broadcast() {},
    retryDelaysMs: [],
  });
  let turns = 0;
  restarted.agent = {
    async run(input, options) {
      turns++;
      options.onEvent({ type: "turn.started", sessionId: "s2" });
      return { sessionId: "s2", status: "finished", text: "The outcome is unknown." };
    },
  };
  t.after(() => restarted.dispose());
  restarted.tasks.start();
  await until(
    () => restored.state.taskBatches[0].notification !== "pending",
    "batch delivery",
  );
  assert.equal(
    restarted.tasks.view(restored.state.taskBatches[0]).complete,
    true,
  );
  const reports = (await restored.getMessages(`bot:${a.id}`)).filter(
    (message) => message.taskBatchId,
  );
  assert.equal(reports.length, 1);
  assert.ok(reports[0].text.includes(tr("task.unknownOutcome")));
  // The interrupted task is reported, not run again.
  assert.equal(turns, 0);
});

test("a parent waiting for an unconfirmed child also closes and tells the user", async (t) => {
  const { store, engine, a, b } = await fixture(t);
  let childTurns = 0;
  engine.agent = {
    async run(input, options) {
      if (input.text.endsWith("delegate-to-bob")) {
        await engine.tasks.dispatch(
          a,
          { request_id: "child", tasks: [{ to: b.id, message: "child work" }] },
          { turn: engine.bindCallerTurn(a.id) },
        );
        options.onEvent({ type: "turn.started", sessionId: "parent" });
        return { sessionId: "parent", status: "finished", text: "dispatched" };
      }
      childTurns++;
      options.onEvent({ type: "turn.started", sessionId: "child" });
      throw unknownOutcome();
    },
  };
  const receipt = await engine.tasks.dispatch(
    undefined,
    { request_id: "parent", tasks: [{ to: a.id, message: "delegate-to-bob" }] },
    { turn: { chatId: `bot:${a.id}` } },
  );
  await until(() => idle(engine), "idle");
  await until(
    () => engine.tasks.batches.every((batch) => batch.notification !== "pending"),
    "batch delivery",
  );
  const parent = engine.tasks.batches.find((item) => item.id === receipt.batch_id);
  assert.equal(engine.tasks.view(parent).complete, true);
  assert.equal(childTurns, 1);
  const reports = (await store.getMessages(`bot:${a.id}`)).filter(
    (message) => message.taskBatchId,
  );
  assert.equal(reports.length, 1);
  assert.ok(reports[0].text.includes(tr("task.unknownOutcome")));
});
