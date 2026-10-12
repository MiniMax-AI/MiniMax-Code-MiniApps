"""Mutation control for the batched ledger build.

A guard that cannot fail is not a guard. Each mutation below breaks one of the rules in
verify-ledger-batch.mjs the way it would actually break in the file, and requires that guard to fail
with the right reason before the file is restored byte for byte.

The rules come in four groups, and the mutations are grouped the same way: the frame is really
handed back; a new exit retires the build in flight; progress goes through the one writer of the
count; and a poll defers without swallowing the tick.

Two of them are about things that are easy to write and hard to see. "The batch size is not a cap"
is the promise 「显示全部」 makes — a loop bounded by the batch constant instead of the group count
still looks like a batched build and quietly shows only the first N turns. And "the token is tested
before the first row is built" is the difference between a stale build stopping and a stale build
putting one more section into a ledger that has already been emptied.
"""
import io
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CLIENT = os.path.join(ROOT, "miniapp", "client", "index.html")
PROBE = os.path.join(HERE, "verify-ledger-batch.mjs")

MUTATIONS = [
    # ---- 1. the frame is really handed back ------------------------------------

    # The original defect wearing a batch: recursion instead of a frame callback is still one
    # unbroken second and a half of main thread.
    ("the batch recurses instead of yielding a frame",
     [("            window.requestAnimationFrame(buildStep);\n",
       "            buildStep();\n")],
     "the build hands the frame back between batches"),

    # The guard above the hand-off moved below it. Harmless-looking, and it re-arms a frame after
    # the last group — the build never ends and the count never stops moving.
    ("the frame is handed back even when there is nothing left to build",
     [("          if (build.at < groups.length) {\n"
       "            setLedgerProgress(build.rows, buildTotal);\n"
       "            window.requestAnimationFrame(buildStep);\n"
       "            return;\n"
       "          }\n",
       "          setLedgerProgress(build.rows, buildTotal);\n"
       "          window.requestAnimationFrame(buildStep);\n"
       "          if (build.at < groups.length) return;\n")],
     "a window that fits in one batch does not spend a frame"),

    # ---- the promise is unchanged ----------------------------------------------

    # 「显示全部」 stops meaning all. Still looks like a batched build.
    ("the batch size becomes a cap on what the table holds",
     [("          while (build.at < groups.length && built < LEDGER_BATCH_GROUPS) {\n",
       "          while (build.at < LEDGER_BATCH_GROUPS) {\n")],
     "显示全部 still means every record: the batch size is not a cap"),

    ("the batch stops advancing its cursor",
     [("            build.at += 1;\n", "")],
     "the batch always advances its cursor"),

    # Zero groups never increments `built`, so the loop schedules itself every frame forever.
    ("the batch is zero groups",
     [("      var LEDGER_BATCH_GROUPS = 25;\n", "      var LEDGER_BATCH_GROUPS = 0;\n")],
     "the batch is at least one group"),

    # ---- 2. a new exit retires the build in flight ------------------------------
    #
    # Re-anchored 2026-10-12 for D14. These two used to hang off `ledgerBuildToken += 1;`
    # followed by `applyFilterScope();`, which is where the bump sat before the four early
    # returns below it were found to retire nothing. The bump now sits directly above
    # `clear(ledger);`, so the line that follows it changed. The rules they encode did not.

    ("the exit retires the build twice",
     [("        ledgerBuildToken += 1;\n        clear(ledger);\n",
       "        ledgerBuildToken += 1;\n        ledgerBuildToken += 1;\n        clear(ledger);\n")],
     "every pass through the exit retires the build in flight"),

    # The new build is handed the token the previous build was still using, so the two compare
    # equal and the interleaving the token exists to prevent becomes possible.
    #
    # Re-anchored 2026-10-12 for D15: the `build` literal gained `bands` and `heights`, so the
    # anchor that used to end the literal at `rows: 0 }` stopped matching. The rule is the token
    # being claimed, not the shape of the object carrying it, so the anchor is the first half of
    # the literal alone — which is stable against fields being added after it.
    ("the new build claims a token that is not yet retired",
     [("        ledgerBuildToken += 1;\n        clear(ledger);\n", "        clear(ledger);\n"),
      ("at: 0, rows: 0, bands: 0, heights: null };\n",
       "at: 0, rows: 0, bands: 0, heights: null };\n        ledgerBuildToken += 1;\n")],
     "the exit retires the old build before the new one claims a token"),

    # D14: the bump has to be above clear(ledger), not merely somewhere earlier. Put it back
    # where it was — below the four early returns — and a pass that returns early (loading,
    # error, no payload, no sessions) retires nothing, so the previous build goes on appending
    # turn groups into whatever that pass left in the ledger. The bump line itself is still
    # there and still unique, which is why verify-ledger-batch.mjs counts the returns between it
    # and clear() rather than asserting a position.
    ("a pass that returns early retires nothing",
     [("        ledgerBuildToken += 1;\n        clear(ledger);\n", "        clear(ledger);\n"),
      ("        var matched = visibleEntries();\n",
       "        ledgerBuildToken += 1;\n        var matched = visibleEntries();\n")],
     "no early return sits between the token bump and the clear"),

    ("a replaced build keeps appending",
     [("          if (build.token !== ledgerBuildToken) return;\n", "")],
     "a build whose exit has been replaced stops without appending"),

    # Checks after the work rather than before it: the stale build puts one more section into a
    # ledger renderLedger() has already emptied.
    ("the token is checked after the rows are already built",
     [("          if (build.token !== ledgerBuildToken) return;\n", ""),
      ("          if (build.at < groups.length) {\n",
       "          if (build.token !== ledgerBuildToken) return;\n          if (build.at < groups.length) {\n")],
     "the token is tested before the first row is built"),

    # ---- 3. one writer of the count --------------------------------------------

    ("progress reaches for the count node itself",
     [("        ledgerProgress = rows === null ? null : { rows: rows, total: total };\n",
       "        ledgerProgress = rows === null ? null : { rows: rows, total: total };\n"
       "        document.getElementById('window-count').textContent = String(rows);\n")],
     "progress is reported through the one writer of the count"),

    # A second writer of the count. The variable is fetched into a local `parts` on purpose: the
    # guard counts `parts.count.textContent =` occurrences, and writing through windowBarParts
    # directly would not match that pattern — a mutation that does not actually add a writer proves
    # nothing about whether the guard would notice one.
    ("a second writer of the window bar count",
     [("        if (ledgerWindow) {\n",
       "        var parts = windowBarParts;\n        if (parts) parts.count.textContent = 'building';\n        if (ledgerWindow) {\n")],
     "the window bar count has exactly one writer"),

    # 「已显示 18,924 条」 above three thousand rows that exist — the page promising a number it
    # has not reached, which is the defect this exit exists to prevent.
    ("the mid-build count claims the rows are already shown",
     [("            '共 ' + formatInt(total) + ' 条 · 正在显示 ' + formatInt(ledgerProgress.rows) +\n"
       "            ' / ' + formatInt(ledgerProgress.total) + ' 条';\n",
       "            '共 ' + formatInt(total) + ' 条 · 已显示 ' + formatInt(shown.length) + ' 条';\n")],
     "the mid-build count reports rows built, not rows promised"),

    ("progress outlives the build",
     [("          setLedgerProgress(null);\n          restoreRowAnchor(anchor, scrollY);\n",
       "          restoreRowAnchor(anchor, scrollY);\n")],
     "progress cannot outlive the build"),

    # Falls through and overwrites itself with the progress line, so a settled window keeps
    # reading 「正在显示 …」 for ever.
    ("a settled window is still reported as mid-build",
     [("            ' / ' + formatInt(ledgerProgress.total) + ' 条';\n          return;\n        }\n",
       "            ' / ' + formatInt(ledgerProgress.total) + ' 条';\n        }\n")],
     "a settled window is not reported as mid-build"),

    # ---- 4. the poll defers, and the deferral is not swallowed ------------------

    # The build takes ~4 s and the interval is 2.5 s, so this is the difference between a progress
    # bar and a counter that resets to zero forever.
    ("a poll replaces a table that is still being built",
     [("          if (ledgerBuilding()) {\n"
       "            pollDeferred = true;\n"
       "            return;\n"
       "          }\n", "")],
     "a poll never replaces a table that is still being built"),

    # Cleared after the fetch, so every flush re-arms itself and the page polls once per frame.
    ("the held-back poll re-arms itself",
     [("        pollDeferred = false;\n        fetchSessions();\n        fetchTrajectory(false);\n",
       "        fetchSessions();\n        fetchTrajectory(false);\n        pollDeferred = false;\n")],
     "the held-back poll is run once, and only once"),

    ("the held-back poll is swallowed at the end of a build",
     [("          flushDeferredPoll();\n", "          /* dropped */\n")],
     "the held-back poll is not swallowed at the end of a build"),

    # A second flag that has to agree with the progress one, and the day it stops agreeing the
    # poll starts replacing tables that are still being built.
    ("the in-flight flag becomes a second variable",
     [("      function ledgerBuilding() {\n        return ledgerProgress !== null;\n      }\n",
       "      function ledgerBuilding() {\n        return buildRunning !== null;\n      }\n")],
     "the in-flight flag is derived from the progress, not a second variable"),

    # ---- the finishing path -----------------------------------------------------

    # Measuring first and flushing second puts the strip measurement ahead of a call that can
    # start the next exit. verify-sticky.mjs pins the measurement as the last thing the finishing
    # path does; this breaks that from the other end. The second anchor carries the closing brace,
    # because `syncStickyOffsets();` on its own also matches scheduleStickyOffsets' own call.
    ("the finishing path measures before it flushes",
     [("          flushDeferredPoll();\n", "          /* moved below */\n"),
      ("          syncStickyOffsets();\n        }\n",
       "          syncStickyOffsets();\n          flushDeferredPoll();\n        }\n")],
     "the finishing path anchors, then flushes, then measures"),
]

original = io.open(CLIENT, encoding="utf-8", newline="").read()


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
for title, edits, expect in MUTATIONS:
    for old, _ in edits:
        hits = original.count(old)
        if hits != 1:
            raise SystemExit("FAIL  anchor for %r matched %d times" % (title, hits))
    try:
        mutated = original
        for old, new in edits:
            mutated = mutated.replace(old, new, 1)
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
        io.open(CLIENT, "w", encoding="utf-8", newline="").write(original)

restored = io.open(CLIENT, encoding="utf-8", newline="").read()
after_code, after = run()
after_ok = after_code == 0 and "0 failed" in after
print(("ok   " if restored == original else "FAIL ") + "client restored byte for byte")
print(("ok   " if after_ok else "FAIL ") + "green again after restore")

sys.exit(0 if (ok and all(caught) and restored == original and after_ok) else 1)
