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
 * The run a waiter has to hold on to.
 *
 * The run that was started is handed over, so a waiter does not have to look
 * it up: the page forgets which run belongs to a node as soon as that run is
 * over, and a waiter that looked the map up again would find nothing and
 * stand still until its own timeout.
 *
 * A run that is handed over wins over the one the page happens to know: the
 * handed-over one is the run this wait is about.
 */
export function theRunToWaitFor({ taskId = '', nodeId = '', known = null } = {}) {
  const handed = String(taskId ?? '').trim();
  if (handed) return handed;
  return String(known?.get?.(nodeId) ?? '').trim();
}

/**
 * The run that is going, when the runtime refuses a second run.
 *
 * The refusal names the run that is on the node, so the chain can wait for
 * that run even when this page is not the one that started it.
 */
export function theRunThatIsGoing(error) {
  return String(error?.runId ?? '').trim();
}

/**
 * How long a run that is over stays in the progress panel.
 *
 * A finished run is kept a moment, so the last lines of its log can still be
 * read — and then it goes. A failed run is a finished run: it says what went
 * wrong, the card says it too, and it does not stay on the screen for ever.
 */
export const FINISHED_KEEP_MS = 30_000;

/**
 * Whether a run has left the progress panel.
 *
 * This is the one rule for how long a finished run stays: the panel is about
 * what is going on, so a run that is over is kept a moment — long enough for
 * its last lines to be read — and then it goes. A run that is still going is
 * never let go, and a run that was cancelled has nothing left to show.
 */
export function taskIsExpired(task, { now = Date.now() } = {}) {
  const status = String(task?.status ?? '');
  if (status === 'running' || status === 'waiting-question') return false;
  if (status === 'done' || status === 'error') {
    return now - Number(task?.finishedAt ?? 0) >= FINISHED_KEEP_MS;
  }
  return true;
}

/**
 * The runs the progress panel shows.
 *
 * The panel is about what is happening now: the runs that are going, and the
 * ones that are over for a moment so their last lines can be read. The list
 * is never long — a burst of failures must not fill the screen — and the
 * newest runs are the ones that are kept.
 */
export function panelTasks(tasks, { now = Date.now(), max = 8 } = {}) {
  const list = [...(tasks ?? [])].filter((task) => !taskIsExpired(task, { now }));
  return list.slice(-max);
}

/**
 * Whether the progress panel is shown.
 *
 * The panel is about what is going on: it shows itself when there is
 * something to show, and it stays away when the user put it away — the panel
 * sits over the canvas, so it has to be the user's choice.
 */
export function panelIsShown({ closed = false, tasks = [] } = {}) {
  if (closed) return false;
  return (tasks ?? []).length > 0;
}

/**
 * Whether the panel is put away, after what happened.
 *
 * The user can put the panel away, and it stays away until a run starts: a
 * new run brings it back, because that is what the panel is for.
 *
 * The state of the panel is kept in one place, so the page and the rules
 * cannot disagree about it.
 */
export function panelClosed({ closed = false, event = 'none' } = {}) {
  if (event === 'run-started') return false;
  if (event === 'put-away') return true;
  return Boolean(closed);
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
