"""Break the per-group intrinsic size in the shipped client and require verify-intrinsic-size.mjs
to report each break by name.

Each mutation here reproduces a way D12's rejected version can come back wearing a different hat:
a constant in the stylesheet, the class switched on before the numbers exist, a group left
unsized, a term dropped out of the derivation. See docs/LAYERS.md D15.

Anchors are multi-line and index.html is LF, so they are written with bare \\n and the file is
read and written with newline='' — matching on normalised text while preserving the file's own
endings.
"""
import io
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CLIENT = os.path.join(os.path.dirname(HERE), "miniapp", "client", "index.html")
PROBE = os.path.join(HERE, "verify-intrinsic-size.mjs")

# Every anchor below is text the rule is written on — a declaration, a statement, an argument list.
# Anchoring on prose would mean an edit that merely rewords a comment reported as drift, and an
# edit that breaks the rule without touching the prose went unnoticed.
MUTATIONS = [
    # D12's rejected version, verbatim in spirit: one number for every group, written down.
    ("the size becomes a written-down constant",
     [("      .ledger-body.is-skipping-offscreen .turn-group {\n        content-visibility: auto;\n      }",
       "      .ledger-body.is-skipping-offscreen .turn-group {\n        content-visibility: auto;\n        contain-intrinsic-size: auto 900px;\n      }")],
     "the stylesheet declares no contain-intrinsic-size"),

    # Ungated: the calibration would read heights off subtrees that are already being skipped,
    # which is reading the prediction back and calling it a measurement.
    ("content-visibility is switched on unconditionally",
     [("      .ledger-body.is-skipping-offscreen .turn-group {",
       "      .ledger-body .turn-group {")],
     "content-visibility is gated on the ledger class, not unconditional"),

    # The class goes on in the same batch that builds the groups it will skip. Nothing is laid out
    # yet, so `build.heights` is null forever and every group is sized from nothing.
    # Re-anchored 2026-10-12: the shipped order now puts the class after the measurement loop, so
    # this mutation restores the old one by hoisting the class above the guard instead of editing a
    # line that is no longer there. The mutation is not the defect — dropping it would leave the
    # guard weaker than it was on the day it was written.
    ("the class is switched on before the first batch exists",
     [("          if (!build.heights) {\n            build.heights = calibrateRowHeights(ledger);\n",
       "          ledger.classList.add('is-skipping-offscreen');\n          if (!build.heights) {\n            build.heights = calibrateRowHeights(ledger);\n")],
     "the class is switched on inside the calibration guard, not before it"),

    # The shipped bug, verbatim: skipping on before the measurement rather than after it.
    # Unlike the mutation above this one leaves the class inside the guard and before the
    # "more batches remain" check, so it satisfies the assertion that was already here and gets
    # through — which is exactly why it shipped through 44 guards, a validation, a publish and a
    # browser measurement. It reads 0 for every group in the batch and writes that 0 onto them.
    ("the class goes on before the first batch is measured",
     [("            for (var f = 0; f < firstBatch.length && f < LEDGER_BATCH_GROUPS; f += 1) {\n              sizeBuiltGroup(firstBatch[f]);\n            }\n            ledger.classList.add('is-skipping-offscreen');\n",
       "            ledger.classList.add('is-skipping-offscreen');\n            for (var f = 0; f < firstBatch.length && f < LEDGER_BATCH_GROUPS; f += 1) {\n              sizeBuiltGroup(firstBatch[f]);\n            }\n")],
     "the class goes on after the first batch has been measured, not before"),

    # The half that actually shipped. The class lives on the ledger element and clear(ledger)
    # empties its children without touching its own class, so the ordering fix above only covers
    # the first build after a page load: every rebuild after it appends groups that are already
    # skipped and measures them at 0. Dropping the removal restores that.
    ("skipping is never turned off, so a rebuild measures through it",
     [("        ledger.classList.remove('is-skipping-offscreen');\n", "")],
     "the ledger turns skipping off before it starts building, so a rebuild does not measure under it"),

    # Calibrating per batch instead of once: every later batch mixes measured heights with
    # skipped ones, and the numbers drift batch by batch instead of staying fixed.
    ("the calibration is re-run every batch",
     [("          if (!build.heights) {\n", "          if (!build.heights || true) {\n")],
     "the calibration happens once per build, not once per batch"),

    # The half that is easiest to drop and hardest to notice: the first batch is the only set of
    # groups that exists before there is anything to predict from, so nobody looks at them again.
    ("the first batch is left unsized",
     [("              sizeBuiltGroup(firstBatch[f]);\n", "")],
     "the first batch, which existed before there was anything to predict from, is sized too"),

    # Every group after the calibration stops being sized, which is the same collapse applied to
    # 127 of 152 groups instead of 25 — and the count of sized groups is what the measurement reads.
    ("later groups are left unsized",
     [("            applyIntrinsicSize(section, group.entries.length, bands, build.heights);\n", "")],
     "a group is sized before it is appended, in the row loop"),

    # Predicting before there is anything to predict from. Dropping the guard does not write a
    # wrong number — it throws on `null.head`, and the throw happens while the very first batch is
    # being built, before a single row reaches the ledger.
    ("the guard against sizing without heights is dropped",
     [("      function applyIntrinsicSize(section, rows, bands, heights) {\n        if (!heights) return;\n",
       "      function applyIntrinsicSize(section, rows, bands, heights) {\n")],
     "declining to size without heights is not a crash"),

    # The bands term dropped: a session with compaction turns under-reports its own height, and the
    # error is proportional to how much of the session got compressed, so it grows over time.
    ("compaction bands stop counting",
     [("        var h = heights.head + rows * heights.row + bands * heights.band;\n",
       "        var h = heights.head + rows * heights.row;\n")],
     "compaction bands are counted at their own measured height"),

    # `auto` dropped: the prediction is frozen forever, so scrolling down and back accumulates the
    # difference between the frozen number and what the group actually took.
    ("the size stops being remembered",
     [("        section.style.containIntrinsicSize = 'auto ' + Math.round(h) + 'px';\n",
       "        section.style.containIntrinsicSize = Math.round(h) + 'px';\n")],
     "the size is remembered rather than frozen"),
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