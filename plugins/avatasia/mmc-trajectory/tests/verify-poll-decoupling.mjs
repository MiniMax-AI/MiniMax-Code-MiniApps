/**
 * One `POLL_INTERVAL` drove both `/api/sessions` and `/api/trajectory`, and it was wrong for both.
 *
 * The list is a cached walk, a cached title read and a descriptor cache — and now a validator, so
 * an unchanged list usually costs a 304. It is cheap, and it is also the only thing that keeps the
 * session picker's 「刚刚」 honest, because that label is rendered against a render-time clock.
 *
 * The trajectory is a different cost class entirely: on a session that is growing it reparses the
 * whole lineage, rebuilds a payload that measured 18,924 rows, and opens the runtime database
 * again to work out which conversation is live. Giving it the same 2.5 s tick meant paying that on
 * a clock rather than on evidence.
 *
 * So there are two ticks, and the load-bearing part is not the numbers — it is that the cheap
 * fetch wakes the expensive one. A 200 from the list means something in the visible slice moved;
 * a 304 means nothing on screen can be stale. That is what makes a slower trajectory tick a floor
 * on latency rather than a delay applied to every change.
 *
 * The invariants, and why each is here:
 *
 *   1. Two cadences, and the expensive one is the slower one. Asserted as a relationship: pinning
 *      `=== 8000` would fail for a tuning change that improves things and pass for a swap.
 *   2. The single `POLL_INTERVAL` is gone. It cannot come back as a substring of either new name —
 *      `SESSION_POLL_INTERVAL` contains `POLL_INTERVAL` — so the check strips both before looking.
 *   3. Both timers are registered and both are cleared. One registered and forgotten is a page
 *      that keeps polling after the reader navigates away, with nothing left to stop it.
 *   4. The build guard belongs to the trajectory alone. It exists because a table still being
 *      built must not be replaced mid-build — a ledger concern. Holding the list back with it was
 *      the two fetches sharing a tick, not anything the build needs: the list renders an
 *      `<option>` list and never touches the ledger.
 *   5. A 304 does not wake the trajectory, and a 200 does. The first half keeps the fast tick
 *      free; the second half is the whole reason the slow tick is tolerable.
 *   6. A hidden tab still stops both.
 *   7. The deferred tick is still remembered and still flushes both, so a build that overran the
 *      trajectory tick does not leave the reader looking at a session that finished before it.
 *
 * `tests/mutate-poll-decoupling.py` breaks each of these in the shipped client and requires this
 * guard to report it by name.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SERVER = fileURLToPath(new URL('../miniapp/node/server.mjs', import.meta.url));
const HTML = fileURLToPath(new URL('../miniapp/client/index.html', import.meta.url));
const html = readFileSync(HTML, 'utf8');
const server = readFileSync(SERVER, 'utf8');

let pass = 0;
const failures = [];
function assert(name, cond) {
  if (cond) pass += 1;
  else failures.push(name);
}

/* ---------- 1: two cadences, and the expensive one is the slower one ---------- */

const sessionCadence = /var SESSION_POLL_INTERVAL\s*=\s*(\d+)/.exec(html);
const trajectoryCadence = /var TRAJECTORY_POLL_INTERVAL\s*=\s*(\d+)/.exec(html);

assert('the list\'s cadence is still declared', sessionCadence !== null);
assert('the trajectory\'s cadence is still declared', trajectoryCadence !== null);

if (sessionCadence && trajectoryCadence) {
  assert('the trajectory is polled no faster than the list (' + trajectoryCadence[1] + ' vs ' + sessionCadence[1]
    + ') — the expensive fetch is the one that has to slow down',
    Number(trajectoryCadence[1]) > Number(sessionCadence[1]));
}

// The list cache is answerable at the list's cadence. If the two ticks ever swap, this is the
// assertion that notices, and it lives in verify-list-cache.mjs because it owns the constants.
assert('the list cache budget is still tied to the list\'s cadence, not to a shared one',
  /const LIST_CACHE_TTL_MS\s*=\s*\d+/.test(server)
  && /is at or above the list poll interval/.test(
    readFileSync(fileURLToPath(new URL('./verify-list-cache.mjs', import.meta.url)), 'utf8')));

/* ---------- 2: the shared interval is gone ---------- */

// Stripping both new names first is the whole point: `SESSION_POLL_INTERVAL` contains
// `POLL_INTERVAL`, so a check written against the old bare name matches either constant.
const withoutNewNames = html.replace(/SESSION_POLL_INTERVAL|TRAJECTORY_POLL_INTERVAL/g, '');
assert('the single shared POLL_INTERVAL no longer exists', !/\bPOLL_INTERVAL\b/.test(withoutNewNames));

/* ---------- 3: both timers are registered and both are cleared ---------- */

const start = /function startPolling\(\) \{[\s\S]*?\n      \}/.exec(html);
const stop = /function stopPolling\(\) \{[\s\S]*?\n      \}/.exec(html);
assert('startPolling is still in the shipped client', start !== null);
assert('stopPolling is still in the shipped client', stop !== null);

if (start && stop) {
  const started = start[0];
  const stopped = stop[0];
  assert('the list gets its own tick', /sessionPollTimer = window\.setInterval/.test(started));
  assert('the trajectory gets its own tick', /trajectoryPollTimer = window\.setInterval/.test(started));

  assert('stopPolling clears the list tick',
    /clearInterval\(sessionPollTimer\)[\s\S]*?sessionPollTimer = null/.test(stopped));
  assert('stopPolling clears the trajectory tick',
    /clearInterval\(trajectoryPollTimer\)[\s\S]*?trajectoryPollTimer = null/.test(stopped));

  /* ---------- 4: the build guard is the trajectory's alone ---------- */

  const listTick = /sessionPollTimer = window\.setInterval\(function \(\) \{[\s\S]*?\}, SESSION_POLL_INTERVAL\);/.exec(started);
  const trajectoryTick = /trajectoryPollTimer = window\.setInterval\(function \(\) \{[\s\S]*?\}, TRAJECTORY_POLL_INTERVAL\);/.exec(started);
  assert('the list tick is one callback', listTick !== null);
  assert('the trajectory tick is one callback', trajectoryTick !== null);

  if (listTick && trajectoryTick) {
    assert('the list tick is not held back by a ledger build',
      !/ledgerBuilding\(\)/.test(listTick[0]));
    assert('the trajectory tick is still held back by a ledger build',
      /if \(ledgerBuilding\(\)\)/.test(trajectoryTick[0]));
    // Deferring has to stay attached to the tick that can be deferred, or the flag is set by a
    // tick that does nothing and cleared by one that already ran.
    assert('the deferred tick belongs to the trajectory tick',
      /pollDeferred = true/.test(trajectoryTick[0]) && !/pollDeferred/.test(listTick[0]));
    assert('the trajectory tick fetches the trajectory', /fetchTrajectory\(false\)/.test(trajectoryTick[0]));
    assert('the list tick does not also fetch the trajectory on its own tick',
      !/^\s*fetchTrajectory\(false\);\s*$/m.test(listTick[0]));

    /* ---------- 5: a 304 does not wake the trajectory, a 200 does ---------- */

    assert('the list tick wakes the trajectory when the list changed',
      /fetchSessions\(\)\.then\(function \(changed\) \{[\s\S]*?if \(changed\) fetchTrajectory\(false\);/.test(listTick[0]));
    // The counter-case, and the cheaper half: a 304 resolves to `false`, so the wake is gated on
    // it and an unchanged list wakes nothing. An ungated call would be correct — the trajectory
    // would answer 304 as well — and would reopen the runtime database and walk the lineage on
    // every poll forever, which is the bill this split was made to stop.
    assert('the trajectory is only woken when the list reports a change',
      !/^[ \t]*fetchTrajectory\(false\);[ \t]*$/m.test(listTick[0]));

    /* ---------- 6: a hidden tab stops both ---------- */

    assert('a hidden tab skips the list tick', /if \(document\.hidden\) return;/.test(listTick[0]));
    assert('a hidden tab skips the trajectory tick', /if \(document\.hidden\) return;/.test(trajectoryTick[0]));
  }
}

/* ---------- 7: the deferred tick still flushes both ---------- */

const flush = /function flushDeferredPoll\(\) \{[\s\S]*?\n      \}/.exec(html);
assert('flushDeferredPoll is still in the shipped client', flush !== null);
if (flush) {
  assert('a deferred tick still refreshes the list', /fetchSessions\(\)/.test(flush[0]));
  assert('a deferred tick still refreshes the trajectory', /fetchTrajectory\(false\)/.test(flush[0]));
}

/* ---------- 8: why the list keeps the fast tick, in the code that depends on it ---------- */

// The 口径 half. The picker's recency is rendered from a render-time clock, so a slower list tick
// does not make the label wrong — it makes it sit still and then jump. This is the reader-visible
// reason the two cadences are ordered the way they are, and it is asserted here rather than only
// argued in a comment, because a comment does not fail.
const picker = /function renderSessionSelect\(\) \{[\s\S]*?\n      \}/.exec(html);
assert('renderSessionSelect is still in the shipped client', picker !== null);
if (picker) {
  assert('the picker recomputes recency from a render-time clock',
    /var now = Date\.now\(\);/.test(picker[0])
    && /formatAgo\(session \? session\.lastActiveAt : null, now\)/.test(html));
  assert('the picker is re-rendered whenever a list body arrives',
    /state\.sessions = [\s\S]{0,200}?renderSessionSelect\(\);/.test(html));
}

console.log('[poll-decoupling] ' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('[poll-decoupling] OK');