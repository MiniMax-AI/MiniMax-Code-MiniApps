"""Put the two poll ticks back on one clock in the shipped client and require
verify-poll-decoupling.mjs to report each way it comes back by name.

The defect is not a wrong number. Two fetches of different cost shared a 2500 ms interval, so the
expensive one — which reparses a lineage, rebuilds an 18,924-row payload, and reopens the runtime
database on every request — was paced by a clock instead of by evidence, and the cheap one was
paced by a number chosen for the expensive one. Nothing here is about tuning: it is about the two
ticks existing, being ordered so the costly fetch is the slow one, and the cheap fetch waking the
costly one when something actually moved.

The three that read like tidying and are not:

  * stopPolling clearing one timer. A page that navigated away keeps its list tick alive forever,
    and the symptom is a process that will not go quiet — not a red test.
  * the ledger build guard moving onto the list tick. It exists because a table mid-build must not
    be replaced mid-build, which is a ledger concern; on the list tick it holds back the one fetch
    that has no ledger to redraw, and the 「刚刚」 label stops moving with it.
  * a 304 waking the trajectory. It is correct — the trajectory would answer 304 too — and it
    costs a directory read and an open of the runtime database on every poll forever, which is the
    exact bill this change was made to stop.

Anchors are multi-line and index.html is LF, so they are written with bare \\n and the file is read
and written with newline='' — matching on normalised text while preserving the file's own endings.
No anchor may contain a line ending of its own: one did, and it stopped resolving the moment the
.gitattributes pinning LF landed.
"""
import io
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN = os.path.dirname(HERE)
CLIENT = os.path.join(PLUGIN, "miniapp", "client", "index.html")
PROBE = os.path.join(HERE, "verify-poll-decoupling.mjs")

MUTATIONS = [
    # ---- one clock again, with the expensive fetch on the fast one ----
    #
    # The original defect, expressed as a swap rather than a merge: the trajectory now ticks every
    # 2500 ms and the list every 8000, so nothing is slower than it was and the label is the thing
    # that suffers.
    ("the two cadences are swapped",
     [("      var SESSION_POLL_INTERVAL = 2500;\n      var TRAJECTORY_POLL_INTERVAL = 8000;",
       "      var SESSION_POLL_INTERVAL = 8000;\n      var TRAJECTORY_POLL_INTERVAL = 2500;")],
     "the trajectory is polled no faster than the list", CLIENT),

    # ---- a tick that is registered and never cleared ----
    #
    # The list keeps running after the reader navigates away, because only the trajectory timer
    # has something left to stop it. `stopPolling` is not on the hot path, so nothing else fails.
    ("stopPolling forgets the list tick",
     [("        if (sessionPollTimer !== null) {\n"
       "          window.clearInterval(sessionPollTimer);\n"
       "          sessionPollTimer = null;\n"
       "        }\n", "")],
     "stopPolling clears the list tick", CLIENT),

    ("stopPolling forgets the trajectory tick",
     [("        if (trajectoryPollTimer !== null) {\n"
       "          window.clearInterval(trajectoryPollTimer);\n"
       "          trajectoryPollTimer = null;\n"
       "        }\n", "")],
     "stopPolling clears the trajectory tick", CLIENT),

    # ---- the build guard, which belongs to the trajectory alone ----
    #
    # Moved onto the list tick. It is correct to hold the trajectory back mid-build and wrong to
    # hold the list back, which renders an <option> list and never touches the ledger — and the
    # 「刚刚」 label stops moving for as long as a big window is laid out.
    ("the ledger build guard is applied to the list tick",
     [("          fetchSessions().then(function (changed) {",
       "          if (ledgerBuilding()) { pollDeferred = true; return; }\n"
       "          fetchSessions().then(function (changed) {")],
     "the list tick is not held back by a ledger build", CLIENT),

    # ...and its inverse, which is the original arrangement with the ticks still split: the
    # trajectory tick replaces the ledger it is not allowed to replace, so an 全部 window restarts
    # its build on every tick and the count resets from 3,000 to 0 forever.
    ("the trajectory tick no longer respects a ledger build",
     [("          if (ledgerBuilding()) {\n"
       "            pollDeferred = true;\n"
       "            return;\n"
       "          }\n          fetchTrajectory(false);",
       "          fetchTrajectory(false);")],
     "the trajectory tick is still held back by a ledger build", CLIENT),

    # ---- the wake-up ----
    #
    # The whole reason a slower trajectory tick is tolerable. Without it, new turns wait for the
    # slow tick regardless of how quickly the cheap fetch proved they had arrived.
    ("a changed list no longer wakes the trajectory",
     [("            if (changed) fetchTrajectory(false);", "")],
     "the list tick wakes the trajectory when the list changed", CLIENT),

    # Correct, and the bill this change existed to stop: a 304 means nothing moved, and answering
    # it still opens the runtime database and walks the lineage to return another 304.
    ("every list tick wakes the trajectory, changed or not",
     [("            if (changed) fetchTrajectory(false);",
       "            fetchTrajectory(false);")],
     "the trajectory is only woken when the list reports a change", CLIENT),

    # ---- the hidden tab ----
    #
    # A backgrounded tab that keeps polling a 190 MB session store forever, which is where the
    # 16 GB of reads in 68 minutes went in the first place.
    ("a hidden tab no longer stops the trajectory tick",
     [("        trajectoryPollTimer = window.setInterval(function () {\n"
       "          if (document.hidden) return;",
       "        trajectoryPollTimer = window.setInterval(function () {")],
     "a hidden tab skips the trajectory tick", CLIENT),

    # ---- the deferred tick ----
    #
    # A build that overran the trajectory tick leaves the reader on a session that finished before
    # it, with nothing left to bring them forward.
    ("a deferred tick stops refreshing the trajectory",
     [("    pollDeferred = false;\n        fetchSessions();\n        fetchTrajectory(false);",
       "    pollDeferred = false;\n        fetchSessions();")],
     "a deferred tick still refreshes the trajectory", CLIENT),

    # ---- the reader-visible reason the two are ordered this way ----
    #
    # The picker's recency is rendered against a render-time clock. Stop re-rendering it and the
    # label is not slower, it is wrong: it keeps printing the minute it was rendered in.
    ("the picker stops recomputing recency from the clock",
     [("        var now = Date.now();\n        for (var i = 0; i < state.sessions.length; i += 1) {",
       "        var now = state.pickerRenderedAt || (state.pickerRenderedAt = Date.now());\n"
       "        for (var i = 0; i < state.sessions.length; i += 1) {")],
     "the picker recomputes recency from a render-time clock", CLIENT),
]

ORIGINAL = io.open(CLIENT, encoding="utf-8", newline="").read()


def run():
    proc = subprocess.run(["node", PROBE], cwd=HERE,
                          capture_output=True, text=True, encoding="utf-8", errors="replace")
    return proc.returncode, proc.stdout + proc.stderr


ok = True
code, baseline = run()
base_ok = code == 0 and "0 failed" in baseline
print(("ok   " if base_ok else "FAIL ") + "baseline green")
ok = ok and base_ok

caught = []
# Every mutation here is in the client, so the trailing element is the target and is kept
# explicit for symmetry with the controls that span two files.
for title, edits, expect, target in MUTATIONS:
    for old, new in edits:
        hits = ORIGINAL.count(old)
        if hits != 1:
            raise SystemExit("FAIL  anchor for %r matched %d times" % (title, hits))
        if old == new:
            raise SystemExit("FAIL  empty mutation for %r: the anchor equals its replacement" % title)
    try:
        mutated = ORIGINAL
        for old, new in edits:
            mutated = mutated.replace(old, new, 1)
        if mutated == ORIGINAL:
            raise SystemExit("FAIL  mutation for %r changed nothing" % title)
        io.open(CLIENT, "w", encoding="utf-8", newline="").write(mutated)
        during_code, during = run()
        named = expect in during
        red = during_code != 0
        # A guard that crashes is not a guard that caught anything: the rule has to be reported by
        # name, or the mutation only proved that the file no longer parses.
        print(("ok   " if (named and red) else "FAIL ") + "guard catches: " + title)
        if not named:
            print("       no assertion reported %r" % expect)
            for line in during.splitlines()[-4:]:
                print("       " + line.strip())
        elif not red:
            print("       the rule was reported but the guard still exited 0")
        caught.append(named and red)
    finally:
        io.open(CLIENT, "w", encoding="utf-8", newline="").write(ORIGINAL)

restored = io.open(CLIENT, encoding="utf-8", newline="").read() == ORIGINAL
after_code, after = run()
after_ok = after_code == 0 and "0 failed" in after
print(("ok   " if restored else "FAIL ") + "index.html restored byte for byte")
print(("ok   " if after_ok else "FAIL ") + "green again after restore")

sys.exit(0 if (ok and all(caught) and restored and after_ok) else 1)