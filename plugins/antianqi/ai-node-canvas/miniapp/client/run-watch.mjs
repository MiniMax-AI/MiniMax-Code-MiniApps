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
