// The rules for watching a run.
//
// A run is a thing that happens somewhere else: the runtime asks the
// provider, the page asks the runtime, and the card shows what came back.
// The page has to keep asking, and it has to keep asking even when the
// answer does not come.
//
// Two rules live here, and both of them are about that:
//
//   - a request carries a deadline, because a request that never comes back
//     would stop the loop that asked for it, and the card would turn for
//     ever on a run that is long gone;
//   - a run the runtime does not know any more is said out loud, because a
//     card that turns for ever tells the user nothing.

/**
 * A call with a deadline.
 *
 * The call gets an abort signal, so the work it started can be let go when
 * the deadline passes: the one that asked is free to ask again, and the
 * one that was asked is not left hanging on to a promise nobody waits for.
 */
export async function withDeadline(call, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await call(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether the answer says the run is gone.
 *
 * The runtime answers 404 for a run it does not know: the runtime was
 * restarted, so that run is never going to finish. A request that timed out
 * is another matter — the run may still be going — so a timeout is not a
 * lost run.
 */
export function runIsGone(error) {
  return Number(error?.status) === 404;
}

/**
 * Whether the runtime refused because the node is already running.
 *
 * That is not a failure: the run that is on the node is the one the chain has
 * to wait for, and marking the node as failed would be a lie.
 */
export function isBusyRefusal(error) {
  return String(error?.code ?? '') === 'BUSY';
}

/**
 * Wait for one run to be over.
 *
 * The run is held on to **by its id**. The page forgets which run belongs to a
 * node as soon as that run is over — the node is free to run again — so a
 * waiter that looked the run up again would never see it finish, and the chain
 * would stand still until its own timeout.
 *
 * The run that is waited for may be one that was already going: the runtime
 * refuses a second run on the same node, so a chain that meets a busy node
 * waits for the run that is there.
 */
export function waitForTheRun({
  taskId,
  readTask,
  timeoutMs = 2_700_000,
  intervalMs = 200,
  now = () => Date.now(),
  schedule = (fn, ms) => setTimeout(fn, ms),
} = {}) {
  return new Promise((resolve) => {
    const started = now();
    const tick = () => {
      const task = taskId ? readTask(taskId) : null;
      if (task && !['running', 'waiting-question'].includes(task.status)) {
        resolve(task);
        return;
      }
      if (!taskId) {
        // There is no run to wait for, so nothing is going to happen.
        resolve(null);
        return;
      }
      // A video on MiniMax-H3 takes 15-30 minutes, so the wait is long enough
      // for a slow generation and not a timeout of its own.
      if (now() - started > timeoutMs) {
        resolve(null);
        return;
      }
      schedule(tick, intervalMs);
    };
    tick();
  });
}
