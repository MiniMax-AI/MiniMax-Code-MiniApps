"""Mutation control for the selection guards.

A guard that cannot fail is not a guard. Each mutation below breaks one of the rules in
verify-selection.mjs the way it would actually break in the file, and requires that guard to fail
with the right reason before the file is restored byte for byte.

Each mutation is a list of edits rather than one substitution, because some of these rules span two
lines that have to move together — moving the call on its own is not a defect at all: it sat
immediately above the slice already, and raised `state.limit` before the window was cut exactly as
it should. A mutation that changes the text without changing what the page does proves nothing.

The first one is the bug this file exists for: reading `state.flat` instead of the list handed in.
The stub in the guard carries both, so the reverted version runs to a wrong answer rather than
throwing — it keeps a selection the reader can no longer see, which is exactly what shipped.
"""
import io
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CLIENT = os.path.join(ROOT, "miniapp", "client", "index.html")
PROBE = os.path.join(HERE, "verify-selection.mjs")

MUTATIONS = [
    # The bug. The rows come from visibleEntries(); the selection was checked against the whole
    # session, so a filtered-out record stayed selected and the inspector kept describing a row that
    # was no longer on screen.
    ("the selection is judged against the whole session again",
     [("        for (var i = 0; i < entries.length; i += 1) {\n"
       "          if (entries[i].record.id === state.selectedId) {\n"
       "            var needed = entries.length - i;\n",
       "        for (var i = 0; i < state.flat.length; i += 1) {\n"
       "          if (state.flat[i].record.id === state.selectedId) {\n"
       "            var needed = state.flat.length - i;\n")],
     "a record the filter removed loses its selection"),

    # A filtered-out record that is never cleared: the panel keeps showing it and no row carries the
    # mark, so nothing on the page contradicts anything else on the page.
    ("a filtered-out record keeps its selection",
     [("        state.selectedId = null;\n        return true;\n      }\n\n      /**\n       * The selected record, or null.\n",
       "      }\n\n      /**\n       * The selected record, or null.\n")],
     "a record the filter removed loses its selection"),

    # The window has to reach the selection, or the record is 'revealed' by a row that is never
    # drawn. Counted over the session it also over-reaches: 12 rows where 8 are enough.
    ("the window is never pulled down to the selection",
     [("            var needed = entries.length - i;\n"
       "            if (needed > state.limit) state.limit = Math.min(needed, entries.length);\n",
       "            var needed = entries.length - i;\n")],
     "the window is pulled down to a selection below it, counted over the table"),

    # The poll path was the only caller, which is why a local filter change never reached it.
    ("the selection is never re-judged when the table changes",
     [("        if (revealSelection(matched)) renderInspector();\n", "")],
     "the selection is re-judged at the one exit every filter passes through"),

    # The half that is easy to miss, because the state is correct afterwards and only the DOM is
    # stale: nine writers reach renderLedger() without redrawing the panel, so the search box left
    # the inspector naming a record that had just been dropped.
    ("the judgement is made but the panel is never redrawn",
     [("        if (revealSelection(matched)) renderInspector();\n",
       "        revealSelection(matched);\n")],
     "the panel is redrawn when the selection is dropped"),

    # And the other half: a verdict nobody is told about cannot be acted on.
    ("dropping the selection is never reported",
     [("        state.selectedId = null;\n        return true;\n",
       "        state.selectedId = null;\n        return false;\n")],
     "dropping the selection is reported so the panel can be redrawn"),

    # Judged after the window is cut: `state.limit` is raised too late for it, so `windowed` and
    # `hiddenAbove` describe a window that is not the one on screen, and the row that was supposed
    # to reveal the selection may not be in it. Two edits — the call has to leave its place and
    # arrive after the slice, or it is still raised in time.
    ("the selection is judged after the window is sliced",
     [("        if (revealSelection(matched)) renderInspector();\n", ""),
      ("        var hiddenAbove = matched.length - windowed.length;\n",
       "        var hiddenAbove = matched.length - windowed.length;\n        revealSelection(matched);\n")],
     "the re-judgement runs against the rows, before the window is sliced"),

    # Two writers. The poll path judged the selection again, and a reader could be told two
    # different things depending on which one ran last.
    ("the poll path judges the selection a second time",
     [("        if (changed) rePinWindow();\n        render();\n",
       "        if (changed) { rePinWindow(); revealSelection(visibleEntries()); }\n        render();\n")],
     "the poll path does not judge the selection a second time"),

    # The list becomes a second read. The caller hands over the rows it is about to build and the
    # function goes and works out a list of its own, which can only agree with the first by luck.
    ("the list to judge against is re-read instead of handed in",
     [("function revealSelection(entries) {\n        if (!state.selectedId) return false;\n",
       "function revealSelection() {\n        if (!state.selectedId) return false;\n        var entries = visibleEntries();\n")],
     "the list to judge against is an argument rather than a second read"),
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