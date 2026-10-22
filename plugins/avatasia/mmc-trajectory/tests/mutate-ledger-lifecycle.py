"""Break the per-group lifecycle in the shipped client and require verify-ledger-lifecycle.mjs
to report each break by name.

The lifecycle has two halves that pull in opposite directions, and a version of this that keeps
one and loses the other is worse than not doing it at all:

  - a group the reader is not on must not be holding its rows, or 47,937 records are 438,986
    nodes and about 470 MB of the renderer's private memory;
  - a group that has given up its rows must still be the height it was, or the document under
    the reader loses everything they have scrolled past — measured at 79,288 px for the groups
    around the viewport and 257,378 px more for the viewport's own group.

Each mutation below breaks one of those, or one of the transitions between them, and the guard
has to name the rule it broke. A mutation that is only "the file no longer parses" proves
nothing, so the guard has to exit non-zero *and* report the rule by name.

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
PROBE = os.path.join(HERE, "verify-ledger-lifecycle.mjs")

# Every anchor below is text the rule is written on — a statement, a condition, an argument
# list. Anchoring on prose would mean an edit that merely rewords a comment reported as drift,
# and an edit that breaks the rule without touching the prose went unnoticed.
#
# `expect` is the name of the assertion the guard has to report. It is a list where one break
# owns more than one rule: removing the class removal breaks both the state the reader sees
# and the rule that says the state is turned off.
MUTATIONS = [
    # The idle timeout is what releases a group the reader has walked away from. Without it a
    # group stays live for as long as the session is open, and the bound below becomes the only
    # thing standing between the reader and 470 MB.
    ("a group the reader has left never gives its rows up",
     [("      if (now - state.lastSeen >= LEDGER_IDLE_MS) {\n",
       "      if (false) {\n")],
     "a group the reader has left gives its rows up once the idle time has passed"),

    # The bound is what makes the memory bounded rather than merely reduced: a reader who
    # scrolls through three hundred groups in a minute has been on all of them.
    ("the number of groups holding their rows is never bounded",
     [("      if (live.length <= LEDGER_LIVE_GROUPS) return;\n",
       "      if (true) return;\n")],
     "the number of groups holding their rows is bounded"),

    # The oldest goes first, which is the order the reader would choose. Sorting the other way
    # releases the group the reader is on and keeps the one they left long ago.
    ("the newest group is released instead of the oldest",
     [("      live.sort(function (a, b) { return a.at - b.at; });\n",
       "      live.sort(function (a, b) { return b.at - a.at; });\n")],
     "the oldest groups are the ones that go when the bound is passed"),

    # The height is the reader's place in the session. `contain-intrinsic-size` sizes a group
    # the browser has skipped, and a group near the viewport is rendered — so without an
    # explicit height the box collapses to its 39 px header and the document shrinks under
    # the reader.
    ("a released group loses the height it had",
     [("        section.style.minHeight = Math.round(height) + 'px';\n",
       "        section.style.minHeight = '';\n")],
     "a released group keeps the height it had"),

    # A group with no measured height gets no reserved height either. Writing 0px would be
    # worse than writing nothing: a group sized 0px can never come back into the viewport, so
    # it is never re-rendered, and the ledger stays collapsed for good.
    ("a group with no height to keep is given one anyway",
     [("        if (!(height > 0)) return;\n",
       "        if (false) return;\n")],
     "a group with no height to keep is not given one"),

    # The rows come back when the reader reaches the group. This is the whole of what the
    # reader is owed for having given them up.
    ("the rows do not come back when the reader reaches the group",
     [("        fillGroupRows(list, group);\n", "")],
     "a group the reader reaches puts its rows back"),

    # The released state is what the reader sees while the group is empty.
    ("the released state is left on after the rows come back",
     [("        section.classList.remove('is-released');\n", "")],
     ["a group that has its rows back drops the released state",
      "the released state is turned off when the rows come back"]),

    # The reserved height is given back when the group has its rows again, or the group is
    # taller than the rows it holds.
    ("the reserved height is not given back after the rows come back",
     [("        section.style.minHeight = '';\n", "")],
     "a group that has its rows back gives its reserved height back"),

    # A group that is already holding its rows is filled by the build and then again by the
    # observer, and the second pass appends every row a second time.
    ("a group that is already holding its rows is filled a second time",
     [("        if (section.getAttribute('data-rows') === 'live') return;\n", "")],
     "a group that is already holding its rows is not filled a second time"),

    # The first group of a window is where the reader arrives, and every other group's height
    # is predicted from it. If it does not hold its rows there is nothing to predict from.
    ("the first group of a window does not hold its rows",
     [("        if (isFirst) return true;\n",
       "        if (isFirst) return false;\n")],
     "the first group of a window always holds its rows"),

    # The anchor is read out of the group the reader is on. A released group has no rows, and
    # an anchor read from the next group down that still has rows is an anchor to the wrong
    # place — the reader is moved to wherever that group starts.
    ("the anchor is read without filling the group the reader is on",
     [("          if (sections[s].getAttribute('data-rows') !== 'live') fillLedgerGroup(sections[s]);\n",
       "")],
     "the group the reader is on is filled before the anchor is read out of it"),

    # The build asks for no rows for a group it is not holding. This is the one that carries
    # the whole memory win: asking for them and then hiding them is the same cost.
    ("the build asks for the rows of every group",
     [("            var bands = fillGroupRows(holds ? list : null, group);\n",
       "            var bands = fillGroupRows(list, group);\n")],
     "the build asks for no rows for a group it is not holding"),

    # A group the build is not holding is given a height to keep.
    ("a group the build is not holding is given no height to keep",
     [("              holdLedgerHeight(section, known > 0 ? known : predicted);\n", "")],
     "a group the build is not holding is given a height to keep"),

    # The two states are what the rest of the page reads: the build says which, and the
    # observer fills the other.
    ("a group the build is holding does not say so",
     [("              section.setAttribute('data-rows', 'live');\n", "")],
     "a group the build is holding says so"),
    ("a group the build is not holding does not say so",
     [("              section.setAttribute('data-rows', 'released');\n", "")],
     "a group the build is not holding says so too"),

    # The released state is what the reader sees while the group is empty, so the rule that
    # turns it on has to exist in the build and not only in the stylesheet.
    ("the released state is never turned on",
     [("              section.classList.add('is-released');\n", "")],
     "the released state is turned on by the build"),

    # The bands of a released group are counted even though its rows are not built: its height
    # is predicted from how many bands it has, and a prediction that ignored them would be
    # short by every band in it.
    ("the bands of a released group stop being counted",
     [("          if (isBand) bands += 1;\n",
       "          if (isBand && list) bands += 1;\n")],
     "the bands of a released group are still counted"),

    # A compaction record is a band, not a row, and the test that says so has to be the one the
    # branch uses. A version that computes the test and then ignores it says the same word and
    # renders the record as a row — which is why this break is in the branch rather than in the
    # word.
    ("a compaction record is rendered as a row instead of a band",
     [("          if (isBand) {\n", "          if (false) {\n")],
     "a compaction record is rendered as a band, not as a row"),

    # The map that says which group each section stands for has to go with the sections. A
    # section that is no longer in the table must not be filled when the observer reports it
    # as in view — it would be filled with rows that belong to a table that no longer exists.
    ("the ledger does not forget the groups it just emptied",
     [("        ledgerContent.clear();\n\n        if (state.loading) {\n"
       "          ledger.appendChild(buildSkeleton());\n",
       "        if (state.loading) {\n          ledger.appendChild(buildSkeleton());\n")],
     "the ledger drops what it knew about the groups it just emptied"),

    # A turn key means nothing across two sessions, so the groups of the session being left
    # have to go with it.
    ("the groups of the session being left are not forgotten",
     [("        ledgerState.clear();\n        ledgerContent.clear();\n",
       "        ledgerContent.clear();\n")],
     "the groups of the session being left are forgotten with it"),
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
    names = expect if isinstance(expect, list) else [expect]
    try:
        mutated = original
        for old, new in edits:
            mutated = mutated.replace(old, new, 1)
        io.open(CLIENT, "w", encoding="utf-8", newline="").write(mutated)
        during_code, during = run()
        named = all(n in during for n in names)
        red = during_code != 0
        # A guard that crashes is not a guard that caught anything: the rule has to be reported
        # by name, or the mutation only proved that the file no longer parses.
        print(("ok   " if (named and red) else "FAIL ") + "guard catches: " + title)
        if not named:
            print("       no assertion reported %r" % (names,))
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
