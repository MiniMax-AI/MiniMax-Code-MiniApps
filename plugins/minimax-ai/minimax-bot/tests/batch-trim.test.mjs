import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../miniapp/node/store.mjs";
import { MemoryStore } from "../miniapp/node/memory.mjs";
import { Engine } from "../miniapp/node/engine.mjs";
import { setLocale } from "../miniapp/node/i18n.mjs";

async function until(predicate, label = "condition") {
  for (let i = 0; i < 800; i++) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`Timed out waiting for ${label}`);
}
const idle = (engine) =>
  !engine.tasks.runs.size &&
  !engine.tasks.deliveries.size &&
  !engine.tickets.size;

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "bot-batch-trim-"));
  const store = new Store(dir);
  await store.init();
  const memory = new MemoryStore(dir);
  await memory.init();
  setLocale("en");
  const a = { id: "bot_a", name: "Alice", isMain: true };
  store.state.bots = [a];
  store.state.groups = [];
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
    await until(() => idle(engine)).catch(() => {});
    await store.writeChain;
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, store, engine, a };
}
function agentResult(input, options, text, extra = {}) {
  const ids = { sessionId: `session-${input.text.slice(-12)}`, turnId: "turn" };
  options.onEvent({ type: "turn.started", ...ids });
  return { ...ids, status: "finished", text, ...extra };
}

const SETTLED_BATCHES = 60;
const UNSETTLED_BATCHES = 2;
const LONG_REPLY = "L".repeat(12000);

test("settled batches are pruned and their replies kept to a window, while unsettled ones and the recent task list survive", async (t) => {
  const { engine, store, a, dir } = await fixture(t);
  let turn = 0;
  engine.agent = {
    async run(input, options) {
      turn += 1;
      // The last settled replies are long enough to need a window of their own.
      const long = turn > SETTLED_BATCHES - 3;
      return agentResult(input, options, long ? LONG_REPLY : "short reply");
    },
  };

  const settled = [];
  for (let i = 0; i < SETTLED_BATCHES; i += 1) {
    const receipt = await engine.tasks.dispatch(undefined, {
      request_id: `settled-${i}`,
      tasks: [{ to: a.id, message: `work ${i}` }],
    });
    settled.push(receipt.batch_id);
    await until(() => idle(engine), "idle");
  }

  // Two batches that wait for the user: they still owe work and must never be dropped.
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
  };
  const unsettled = [];
  for (let i = 0; i < UNSETTLED_BATCHES; i += 1) {
    const receipt = await engine.tasks.dispatch(undefined, {
      request_id: `unsettled-${i}`,
      tasks: [{ to: a.id, message: `waiting ${i}` }],
    });
    unsettled.push(receipt.batch_id);
    await until(() => idle(engine), "idle");
  }

  const kept = store.state.taskBatches;
  const keptSettled = kept.filter((batch) => settled.includes(batch.id));

  // Every unsettled batch is still there.
  for (const id of unsettled) {
    assert.ok(
      kept.some((batch) => batch.id === id),
      `unsettled batch ${id} was dropped`,
    );
  }
  // The settled ones are pruned to a bound, and the newest one survives.
  assert.ok(
    keptSettled.length <= 30,
    `settled batches kept: ${keptSettled.length} of ${SETTLED_BATCHES}`,
  );
  assert.ok(
    kept.some((batch) => batch.id === settled.at(-1)),
    "the newest settled batch was dropped",
  );

  // The durable state is bounded the same way.
  const disk = JSON.parse(await readFile(join(dir, "state.json"), "utf8"));
  assert.ok(
    disk.taskBatches.length <= 30 + UNSETTLED_BATCHES,
    `batches on disk: ${disk.taskBatches.length}`,
  );
  const longestResult = Math.max(
    0,
    ...disk.taskBatches.flatMap((batch) =>
      batch.tasks.map((task) => (task.result ?? "").length),
    ),
  );
  assert.ok(
    longestResult <= 8000,
    `longest persisted result: ${longestResult} chars`,
  );

  // The task list still shows the recent tasks and the unsettled ones.
  const ui = engine.tasks.uiList();
  assert.ok(
    ui.some((item) => item.batchId === settled.at(-1)),
    "the newest settled task is not listed",
  );
  for (const id of unsettled) {
    assert.ok(
      ui.some((item) => item.batchId === id),
      `unsettled task of ${id} is not listed`,
    );
  }
  assert.ok(ui.length >= 30, `uiList entries: ${ui.length}`);
});

test("a pruned reply is still readable in full through the durable chat message", async (t) => {
  const { engine, a } = await fixture(t);
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
  await until(() => idle(engine), "idle");

  const task = engine.tasks.task(receipt.tasks[0].task_id);
  assert.ok(task.result.length <= 8000, `stored result: ${task.result.length} chars`);

  let offset = 0;
  let text = "";
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
});

test("a reply window that lost its chat message is reported as truncated", async (t) => {
  const { engine, store, a } = await fixture(t);
  const output = "Long result ".repeat(1800);
  engine.agent = {
    async run(input, options) {
      return agentResult(input, options, output);
    },
  };
  const receipt = await engine.tasks.dispatch(undefined, {
    request_id: "gone",
    tasks: [{ to: a.id, message: "Write" }],
  });
  await until(() => idle(engine), "idle");

  const task = engine.tasks.task(receipt.tasks[0].task_id);
  await store.deleteChat(task.chatId);
  const page = (
    await engine.tasks.get(undefined, { task_id: receipt.tasks[0].task_id })
  ).tasks[0];
  assert.equal(page.result_truncated, true);
  assert.equal(page.result.length, 8000);
  assert.equal(page.next_result_offset, null);
});

test("a trimmed batch still answers a lookup and a retry", async (t) => {
  const { engine, a } = await fixture(t);
  const first = await engine.tasks.dispatch(undefined, {
    request_id: "kept",
    tasks: [{ to: a.id, message: "one" }],
  });
  await until(() => idle(engine), "idle");

  for (let i = 0; i < 40; i += 1) {
    await engine.tasks.dispatch(undefined, {
      request_id: `filler-${i}`,
      tasks: [{ to: a.id, message: `filler ${i}` }],
    });
    await until(() => idle(engine), "idle");
  }

  // 它已经不在活着的批次里了
  assert.equal(
    engine.tasks.batches.some((batch) => batch.id === first.batch_id),
    false,
    "the trimmed batch left the live list",
  );

  // 旧的 batch_id 仍然查得到
  const view = await engine.tasks.get(undefined, { batch_id: first.batch_id });
  assert.equal(view.batch_id, first.batch_id, "the old batch id still answers");

  // 同一个 request_id 再派一次，还是原来那件事，不会重跑一遍
  const again = await engine.tasks.dispatch(undefined, {
    request_id: "kept",
    tasks: [{ to: a.id, message: "one" }],
  });
  assert.equal(again.batch_id, first.batch_id, "the same request id does not start the work again");
});

test("a regenerated reply is not taken for the task's own result", async (t) => {
  const { engine, store, a } = await fixture(t);
  engine.agent = {
    async run(input, options) {
      return agentResult(input, options, LONG_REPLY);
    },
  };
  const receipt = await engine.tasks.dispatch(undefined, {
    request_id: "regenerated",
    tasks: [{ to: a.id, message: "Write" }],
  });
  await until(() => idle(engine), "idle");

  const task = engine.tasks.task(receipt.tasks[0].task_id);
  const stored = task.result;
  assert.ok(stored.length > 0, "the task keeps a window of its reply");

  // The message is retried and comes back as a different reply.
  const messages = await store.getMessages(task.chatId);
  const message = messages.find((item) => item.id === task.messageId);
  assert.ok(message, "the reply is in the chat");
  message.text = "A different answer entirely.";

  const page = await engine.tasks.get(undefined, { task_id: task.id });
  assert.equal(page.tasks[0].result, stored, "the stored window is used, not the newer reply");
  assert.equal(page.tasks[0].result_truncated, true, "the shorter window is flagged as truncated");
});
