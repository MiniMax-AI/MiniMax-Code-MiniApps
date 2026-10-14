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
    #
    # The anchor spans the whole panel body because the replacement has to put the bar *outside*
    # `</section>`, so the edit has to reach the close. D44 is what made it long: the ledger's
    # two-ends control put a sentinel and a button between the bar and the close, and the previous
    # three-line anchor stopped resolving. A broken anchor is a loud failure — this harness refuses
    # to start rather than silently mutating nothing — but it is still a failure a change caused and
    # did not mean to.
    ("the window bar is presented outside the ledger panel",
     '          <div class="window-bar" id="window-bar" aria-label="列表视图控制"></div>\n'
     '          <div class="ledger-body" id="ledger"></div>\n'
     '          <!-- The two ends of the ledger, and the one reading that says which end the reader is\n'
     '               at. See `.ledger-end` and `.ledger-jump` for why the sentinel is outside #ledger. -->\n'
     '          <div class="ledger-end" id="ledger-end" aria-hidden="true"></div>\n'
     '          <!-- No text and no glyph in the markup: buildLedgerJump() fills the arrow in, and the\n'
     '               button starts hidden so the first paint is never an empty circle. The label for a\n'
     '               reader of assistive tech lives in aria-label, which setLedgerJumpLabel() rewrites\n'
     '               with the arrow. -->\n'
     '          <button type="button" class="ledger-jump" id="ledger-jump" hidden aria-label="跳到轨迹的最低"></button>\n'
     '        </section>',
     '          <div class="ledger-body" id="ledger"></div>\n'
     '          <!-- The two ends of the ledger, and the one reading that says which end the reader is\n'
     '               at. See `.ledger-end` and `.ledger-jump` for why the sentinel is outside #ledger. -->\n'
     '          <div class="ledger-end" id="ledger-end" aria-hidden="true"></div>\n'
     '          <!-- No text and no glyph in the markup: buildLedgerJump() fills the arrow in, and the\n'
     '               button starts hidden so the first paint is never an empty circle. The label for a\n'
     '               reader of assistive tech lives in aria-label, which setLedgerJumpLabel() rewrites\n'
     '               with the arrow. -->\n'
     '          <button type="button" class="ledger-jump" id="ledger-jump" hidden aria-label="跳到轨迹的最低"></button>\n'
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
    # Re-anchored 2026-10-14: the landing write went through setOverviewSelection(), so the old
    # `state.overviewSelection = { start: start, end: end }` anchor no longer resolves. The job is
    # unchanged, so the mutation is the same one pointed at the line that now carries it.
    ("the overview brush stops writing the L2 range",
     '        setOverviewSelection({ start: start, end: end });\n'
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
     "        setOverviewSelection(null);\n      }",
     "      }",
     "dropOverviewSelection exists and clears the field through the one writer"),

    ("the strip control goes back to assigning the field itself",
     "        dropOverviewSelection();\n        state.overviewViewport = null;",
     "        abortOverviewDrag();\n        state.overviewSelection = null;\n"
     "        state.overviewViewport = null;",
     "the strip control clears through it rather than through its own assignment"),

    ("the base-filter reset goes back to assigning the field itself, and misses the brush",
     "        dropOverviewSelection();\n        clearTimeRange();",
     "        clearTimeRange();",
     "and so does the base-filter reset, which is the one the empty ledger reaches"),

    # ---- R5, closed 2026-10-14: the four writers are one, and that is now assertable ----
    #
    # Everything above could be true while the field still had four writers. The count could not be
    # asserted (four is unassertable before the fix and unassertable after it), so the rule sat in
    # prose. These four are the things that make 「exactly one writer」 fail, one per way it can.

    # A second writer, at the mode switch. This is the path that used to disagree with the others
    # about the invariant: it cleared the range without disarming the brush.
    ("the mode switch goes back to writing the field itself",
     "        setOverviewSelection(null);\n        state.overviewViewport = null;",
     "        state.overviewSelection = null;\n        state.overviewViewport = null;",
     "R5 holds: state.overviewSelection has exactly one writer"),

    # …and one during the gesture, which is the other half of that disagreement.
    ("the in-flight brush goes back to writing the field itself",
     "          setOverviewSelection({ start: overviewDrag.start, end: overviewDrag.end });",
     "          state.overviewSelection = { start: overviewDrag.start, end: overviewDrag.end };",
     "onOverviewPointerMove reaches the field through the one writer"),

    # The writer keeps its single ownership and loses the invariant. Enumeration still shows one
    # name, so only the second assertion can catch this — which is the reason it exists separately.
    ("the one writer no longer disarms the brush",
     "        if (value === null) abortOverviewDrag();\n        state.overviewSelection = value;",
     "        state.overviewSelection = value;",
     "clearing the range through the writer also disarms the brush in flight"),
]

# Mutations that must leave the guard GREEN. They exist because a guard that cannot pass is as
# useless as one that cannot fail, and this file needed one claim of the second kind to be provable.
#
# The single-writer assertion counts writers by scanning for assignments with the comments stripped
# out — the JSDoc above dropOverviewSelection() spent years describing `state.overviewSelection = null`
# in prose, which is exactly the shape that would make the count come out wrong. Stripping is not
# observable from a failing mutation: without it this edit would be caught, with it the edit is
# invisible, and the two cases are indistinguishable by anything else in this file. So the edit is
# made and the guard is required to stay green.
MUST_STAY_GREEN = [
    ("a comment quoting the old assignment is not counted as a writer",
     "      function dropOverviewSelection() {\n        setOverviewSelection(null);",
     "      function dropOverviewSelection() {\n"
     "        // state.overviewSelection = null;  <- what this used to do\n"
     "        setOverviewSelection(null);"),
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

# The mirror image, and the only way to prove a guard is not simply strict. These edits must leave it
# green: they change what the file SAYS about the writers without changing who the writers are.
stayed_green = []
for title, old, new in MUST_STAY_GREEN:
    hits = original.count(old)
    if hits != 1:
        raise SystemExit("FAIL  anchor for %r matched %d times" % (title, hits))
    try:
        io.open(CLIENT, "w", encoding="utf-8", newline="").write(original.replace(old, new, 1))
        during = run()
        green = GREEN in during
        print(("ok   " if green else "FAIL ") + "guard ignores: " + title)
        if not green:
            print("       the guard reacted to an edit that changes no writer:")
            for line in during.splitlines()[-5:]:
                print("       " + line.strip())
        stayed_green.append(green)
    finally:
        io.open(CLIENT, "w", encoding="utf-8", newline="").write(original)

restored = io.open(CLIENT, encoding="utf-8", newline="").read()
after = run()
after_ok = GREEN in after
print(("ok   " if restored == original else "FAIL ") + "client restored byte for byte")
print(("ok   " if after_ok else "FAIL ") + "green again after restore")

sys.exit(0 if (ok and all(caught_all) and all(stayed_green)
                and restored == original and after_ok) else 1)
