// The action queue: how a change from the Agent reaches a canvas.
//
// The page is the only writer of a canvas. It holds the document in memory and
// saves it, and the store refuses a write that is based on an older version.
// An action that comes from the Agent is therefore never written to the stored
// document behind the page's back.
//
// Two rules make that safe:
//
//   1. A page claims the canvas before it reads it. While the claim is alive
//      the runtime does not write that canvas: the change is handed to the
//      page as an action, and the page applies it with the same rule the
//      runtime would have used.
//
//   2. A claim and a write take turns on the same lock. So a change can never
//      land between the page's claim and the page's read, and the copy the
//      page holds is never older than the last write.
//
// The rules themselves are pure and live in `client/actions.mjs`, so the page
// and the runtime apply the same one.

import { applyAction, materializeResults, runSpecFor } from '../client/actions.mjs';
import { NODE_SIZE, palette } from './capabilities.mjs';
import { capsOf } from './mcp.mjs';

// How long a page's claim lives without a heartbeat.
//
// The heartbeat is a timer in the page, and a browser throttles the timers of
// a tab it does not show — down to once a minute. So the claim has to outlive
// that, or the runtime would think nobody holds the canvas and write it while
// the page still holds a copy of it.
export const OWNER_TTL_MS = 180_000;
// How long the runtime waits for the page to answer an action.
const ACK_TIMEOUT_MS = 8_000;
// How long a delivered action waits before it is handed out again.
const REDELIVER_MS = 10_000;
// How long the runtime waits for a run to settle.
const RUN_MAX_MS = 45 * 60 * 1000;
const RUN_POLL_MS = 1_000;
// How long a finished action is remembered.
const RECORD_TTL_MS = 10 * 60 * 1000;

function sleep(ms) {
  return new Promise((resolve) => {
    // The timer is not a reason to keep the process alive: the runtime may
    // stop while a run is still settling.
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

export function createActionQueue({ store, runner, logger = null, signal = null, ackTimeoutMs = ACK_TIMEOUT_MS }) {
  const actions = new Map();
  const waiters = new Map();
  const owners = new Map();
  const locks = new Map();

  function now() {
    return Date.now();
  }

  function idFor(prefix) {
    return `${prefix}_${now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  }

  // One write at a time per canvas, so a claim and a write cannot cross.
  function withLock(canvasId, task) {
    const previous = locks.get(canvasId) ?? Promise.resolve();
    const next = previous.then(task, task);
    locks.set(canvasId, next.catch(() => {}));
    return next;
  }

  // ---------------------------------------------------------------- ownership

  /** Whether a page holds the canvas right now. */
  function isOwned(canvasId) {
    const owner = owners.get(canvasId);
    if (!owner) return false;
    if (now() - owner.lastSeen > OWNER_TTL_MS) {
      owners.delete(canvasId);
      return false;
    }
    return true;
  }

  /**
   * A page takes the canvas.
   *
   * The claim is taken before the wait, so a write that is about to start
   * waits for this turn instead of landing between the claim and the read.
   */
  async function claim(canvasId) {
    return withLock(canvasId, async () => {
      owners.set(canvasId, { lastSeen: now() });
      return { claimed: true, canvasId };
    });
  }

  /** The heartbeat of a page that holds the canvas. */
  function touch(canvasId) {
    owners.set(canvasId, { lastSeen: now() });
  }

  /** A page that let the canvas go. */
  function release(canvasId) {
    owners.delete(canvasId);
  }

  // ---------------------------------------------------------------- the queue

  function enqueue(canvasId, action) {
    prune();
    const record = {
      id: idFor('a'),
      canvasId,
      type: String(action?.type ?? ''),
      args: action?.args ?? {},
      createdAt: new Date().toISOString(),
      state: 'pending',
      deliveredAt: 0,
      error: '',
      info: null,
    };
    actions.set(record.id, record);
    return record;
  }

  /** The actions a page may pick up. */
  function pending(canvasId) {
    const out = [];
    for (const record of actions.values()) {
      if (record.canvasId !== canvasId) continue;
      if (record.state === 'pending') {
        record.state = 'delivered';
        record.deliveredAt = now();
        out.push(record);
        continue;
      }
      // A delivered action whose page never answered is handed out again, so a
      // page that closed mid-way does not swallow the change. A run is not
      // repeated: it costs money.
      if (
        record.state === 'delivered'
        && record.type !== 'run'
        && now() - (record.deliveredAt ?? 0) > REDELIVER_MS
      ) {
        record.deliveredAt = now();
        out.push(record);
      }
    }
    return out;
  }

  /** The page answers an action. */
  function ack(id, payload) {
    const record = actions.get(id);
    if (!record) return false;
    record.state = payload?.ok ? 'done' : 'failed';
    record.error = String(payload?.error ?? '');
    record.info = payload?.info ?? null;
    const waiter = waiters.get(id);
    if (waiter) {
      waiters.delete(id);
      waiter({ ok: record.state === 'done', error: record.error, info: record.info });
    }
    return true;
  }

  /** Wait for the page to answer an action. */
  function waitFor(id, timeoutMs = ACK_TIMEOUT_MS) {
    const record = actions.get(id);
    if (!record) return Promise.resolve(null);
    if (record.state === 'done' || record.state === 'failed') {
      return Promise.resolve({
        ok: record.state === 'done',
        error: record.error,
        info: record.info,
      });
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        waiters.delete(id);
        resolve(null);
      }, timeoutMs);
      timer.unref?.();
      waiters.set(id, (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  function prune() {
    for (const [id, record] of actions) {
      const age = now() - new Date(record.createdAt).getTime();
      if (age > RECORD_TTL_MS && (record.state === 'done' || record.state === 'failed')) {
        actions.delete(id);
      }
    }
  }

  // ---------------------------------------------------------------- applying

  let catalogPromise = null;

  async function actionContext() {
    if (!catalogPromise) {
      catalogPromise = runner.modelCatalog().catch(() => ({ items: [], defaultKey: null }));
    }
    const catalog = await catalogPromise;
    const modes = palette().modes ?? {};
    return {
      sizes: NODE_SIZE,
      modelsByType: Object.fromEntries(
        Object.entries(modes).map(([type, caps]) => [
          type,
          (caps.models ?? []).map((model) => model.id),
        ]),
      ),
      defaultModelKey: catalog.defaultKey ?? null,
      idFor,
      // What the model this node selected can take. The rules about the modes
      // and the ports ask for it, so the runtime answers the same way the
      // page does.
      capsFor: (node) => capsOf(node),
    };
  }

  /** Write one document change to the stored canvas. */
  async function writeDocument(canvasId, action) {
    const canvas = await store.get(canvasId);
    if (!canvas) return { ok: false, error: '画布不存在' };
    const result = applyAction(canvas, action, await actionContext());
    if (result.error) return { ok: false, error: result.error };
    try {
      await store.save(result.canvas);
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    }
    return { ok: true, info: result.info ?? null };
  }

  /** Hand the change to the page and wait for its answer. */
  async function handToPage(canvasId, action) {
    const record = enqueue(canvasId, action);
    const answer = await waitFor(record.id, ackTimeoutMs);
    if (answer) {
      return { appliedBy: 'page', ok: answer.ok, error: answer.error, info: answer.info };
    }
    // The page holds the canvas, so it is the only one that may write it —
    // even when it is slow, asleep in a background tab, or busy. The change
    // stays in the queue and the page applies it when it wakes up. Writing it
    // here would leave the page holding a copy that is suddenly old, and its
    // next save would be refused.
    if (isOwned(canvasId)) {
      return {
        appliedBy: 'page',
        ok: true,
        error: '',
        info: {
          queued: true,
          message: '画布页面暂时没有回执，这个改动已经排在队列里，它会自己应用',
        },
      };
    }
    // Nobody took it and nobody holds the canvas: the page is not there any
    // more, so the runtime is the writer.
    return { appliedBy: 'runtime', ...(await writeDocument(canvasId, action)) };
  }

  /**
   * Deliver one action to a canvas.
   *
   * The decision who writes is made on the lock, so a page that claims the
   * canvas while the action is on its way is never written over.
   */
  async function deliver(canvasId, action) {
    if (!canvasId) return { ok: false, error: '没有指定画布' };
    if (action?.type === 'run') return deliverRun(canvasId, action);
    const owner = await withLock(canvasId, async () => isOwned(canvasId));
    if (owner) return handToPage(canvasId, action);
    const written = await withLock(canvasId, async () => {
      if (isOwned(canvasId)) return null;
      return writeDocument(canvasId, action);
    });
    if (written) return { appliedBy: 'runtime', ...written };
    // A page claimed the canvas in the meantime: it is the writer now.
    return handToPage(canvasId, action);
  }

  /** Start a run on a canvas nobody is looking at. */
  async function runDirect(canvasId, action) {
    const canvas = await store.get(canvasId);
    if (!canvas) return { ok: false, error: '画布不存在' };
    const node = (canvas.nodes ?? []).find((item) => item.id === action?.args?.nodeId);
    if (!node) return { ok: false, error: '这个画布上没有这个节点' };
    const spec = runSpecFor(canvas, node);
    if (spec.error) return { ok: false, error: spec.error };
    let record;
    try {
      record = await runner.startRun(spec);
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    }
    // The result lands when the run settles.
    void settleAndPlace(canvasId, node.id, record.id);
    return { ok: true, info: { nodeId: node.id, runId: record.id, status: 'started' } };
  }

  async function deliverRun(canvasId, action) {
    const owner = await withLock(canvasId, async () => isOwned(canvasId));
    if (owner) return handToPage(canvasId, action);
    const started = await withLock(canvasId, async () => {
      if (isOwned(canvasId)) return null;
      return runDirect(canvasId, action);
    });
    if (started) return { appliedBy: 'runtime', ...started };
    return handToPage(canvasId, action);
  }

  /** Wait for a run to settle, then put its result on the canvas. */
  async function settleAndPlace(canvasId, nodeId, runId) {
    const started = now();
    while (now() - started < RUN_MAX_MS) {
      if (signal?.aborted) return;
      const task = runner.get(runId);
      if (!task) return;
      if (!['running', 'waiting-question'].includes(task.status)) {
        await placeResult(canvasId, nodeId, task);
        return;
      }
      await sleep(RUN_POLL_MS);
    }
  }

  /** Put the result of a run on the canvas. */
  async function placeResult(canvasId, nodeId, task) {
    const owner = await withLock(canvasId, async () => isOwned(canvasId));
    if (owner) {
      // The page holds the canvas: it places the result itself.
      enqueue(canvasId, { type: 'materialize_result', args: { nodeId, task } });
      return;
    }
    await withLock(canvasId, async () => {
      if (isOwned(canvasId)) return;
      const canvas = await store.get(canvasId);
      const node = (canvas?.nodes ?? []).find((item) => item.id === nodeId);
      if (!node) return;
      const result = materializeResults(canvas, node, task, { sizes: NODE_SIZE, idFor });
      if (result.error) return;
      try {
        await store.save(result.canvas);
      } catch (error) {
        logger?.error?.('nxc.action.result.failed', { canvasId, error: String(error?.message ?? error) });
      }
    });
  }

  return {
    claim,
    touch,
    release,
    enqueue,
    pending,
    ack,
    waitFor,
    deliver,
    isOwned,
    withLock,
  };
}
