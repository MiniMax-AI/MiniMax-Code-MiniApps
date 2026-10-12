"""Mutation control for the R6 cross-layer declarations.

R6 is the rule that lets a control sit in one layer and write another, provided the pair is
written down. A rule that is only prose in docs/LAYERS.md has no failure mode, so the two
declared pairs are asserted here — and a rule nothing tests is exactly the rule that quietly
stops being true.

Every mutation below breaks one half of one declaration in the shipped file and requires
verify-cross-layer.mjs to report that assertion *by name*. If a mutation survives, the guard is
what is wrong: re-anchor it, never delete it.
"""
import io
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CLIENT = os.path.join(ROOT, "miniapp", "client", "index.html")
GUARD = os.path.join(HERE, "verify-cross-layer.mjs")

GREEN = "ALL PASSED"

MUTATIONS = [
    # Declaration 1, position half: the window bar leaves the L5 panel entirely.
    ("the window bar is presented outside the ledger panel",
     '          <div class="window-bar" id="window-bar" aria-label="列表视图控制"></div>\n'
     '          <div class="ledger-body" id="ledger"></div>\n'
     '        </section>',
     '          <div class="ledger-body" id="ledger"></div>\n'
     '        </section>\n'
     '        <div class="window-bar" id="window-bar" aria-label="列表视图控制"></div>',
     "#window-bar is presented inside the ledger panel (L5)"),

    # Declaration 1, write half: the L3 bar starts writing an L3 state field.
    ("the window bar starts writing a state field",
     '        ledgerWindow = { shown: shown, hiddenAbove: hiddenAbove, total: total };',
     '        ledgerWindow = { shown: shown, hiddenAbove: hiddenAbove, total: total };\n'
     '        state.limit = 1;',
     "updateWindowBar writes no state.* field (it is L3, not L2)"),

    # The second writer into the same bar leaves its layer.
    ("the progress writer leaves its layer",
     '        ledgerProgress = rows === null ? null : { rows: rows, total: total };',
     '        ledgerProgress = rows === null ? null : { rows: rows, total: total };\n'
     '        state.kinds = KIND_ORDER.slice();',
     "setLedgerProgress writes no state.* field either"),

    # The converse of declaration 1: a control presented in L5 reaching back into L2.
    ("the window bar reaches back into the L2 brushed range",
     '        applyAxisButton(parts.axis);',
     '        state.overviewSelection = null;\n        applyAxisButton(parts.axis);',
     "neither window-bar writer touches state.overviewSelection"),

    # Declaration 2, write half: the brush stops writing the L2 field entirely.
    ("the overview brush stops writing the L2 range",
     '        state.overviewSelection = { start: start, end: end };\n'
     '        resetWindowMode();\n'
     '        renderOverviewSelection();',
     '        resetWindowMode();\n'
     '        renderOverviewSelection();',
     "the overview brush still writes state.overviewSelection on landing"),

    # Declaration 2, read half: the field survives but nothing filters on it, which is the
    # state where the overview holds a control that does nothing and still looks correct.
    # Anchored to visibleEntries()'s opening lines, not to the assignment alone —
    # renderOverviewSelection() reads the same field one line earlier in the file, and
    # hitting that one instead would leave the L2 entry point intact.
    ("the L2 visibility entry point stops reading the brushed range",
     '        var out = [];\n        var selection = state.overviewSelection;',
     '        var out = [];\n        var selection = null;',
     "the L2 visibility entry point reads state.overviewSelection"),

    # ---- the one clear path R5 has, and the drift it came from (2026-10-12) ----
    #
    # The strip's brush is written from four places and R5 wants one setter; the count is
    # deliberately unasserted because a count cannot fail. What can fail is the two paths whose
    # job is to clear it sharing one writer — and the third mutation below is the actual defect,
    # rebuilt: resetBaseFilters assigning the field itself, which is what the empty ledger's
    # 「清除筛选」 used to do, leaving a brush filtering a ledger the reader had just emptied.

    ("the shared clear writer stops writing the field",
     "        abortOverviewDrag();\n        state.overviewSelection = null;",
     "        abortOverviewDrag();",
     "dropOverviewSelection exists and is what writes the field to null"),

    ("the strip control goes back to assigning the field itself",
     "        dropOverviewSelection();\n        state.overviewViewport = null;",
     "        abortOverviewDrag();\n        state.overviewSelection = null;\n"
     "        state.overviewViewport = null;",
     "the strip control clears through it rather than through its own assignment"),

    ("the base-filter reset goes back to assigning the field itself, and misses the brush",
     "        dropOverviewSelection();\n        clearTimeRange();",
     "        clearTimeRange();",
     "and so does the base-filter reset, which is the one the empty ledger reaches"),
]

original = io.open(CLIENT, encoding="utf-8", newline="").read()


def run():
    proc = subprocess.run(["node", GUARD], cwd=HERE,
                          capture_output=True, text=True, encoding="utf-8", errors="replace")
    return proc.stdout + proc.stderr


ok = True
baseline = run()
base_ok = GREEN in baseline
print(("ok   " if base_ok else "FAIL ") + "baseline green")
ok = ok and base_ok

caught_all = []
for title, old, new, expect in MUTATIONS:
    hits = original.count(old)
    if hits != 1:
        raise SystemExit("FAIL  anchor for %r matched %d times" % (title, hits))
    try:
        io.open(CLIENT, "w", encoding="utf-8", newline="").write(original.replace(old, new, 1))
        during = run()
        named = ("FAIL " + expect) in during
        failed = GREEN not in during
        print(("ok   " if (named and failed) else "FAIL ") + "guard catches: " + title)
        if not named:
            print("       expected the guard to name: " + expect)
        caught_all.append(named and failed)
    finally:
        io.open(CLIENT, "w", encoding="utf-8", newline="").write(original)

restored = io.open(CLIENT, encoding="utf-8", newline="").read()
after = run()
after_ok = GREEN in after
print(("ok   " if restored == original else "FAIL ") + "client restored byte for byte")
print(("ok   " if after_ok else "FAIL ") + "green again after restore")

sys.exit(0 if (ok and all(caught_all) and restored == original and after_ok) else 1)
