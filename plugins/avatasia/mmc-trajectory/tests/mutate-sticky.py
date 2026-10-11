"""Mutation control for the sticky band guards.

A guard that cannot fail is not a guard. Each mutation below breaks one of the rules in
verify-sticky.mjs the way it would actually break in the file, and requires that guard to fail
with the right reason before the file is restored byte for byte.

Three of these are the ones a reader should be least able to guess: the band going transparent
(rows are `background: transparent`, so a band that stops covering them shows them through), the
strip being measured from the band (both are measured, both get written, and the layout still
looks plausible at first), and the measurement moving above the render lines that change the
band's height.
"""
import io
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CLIENT = os.path.join(ROOT, "miniapp", "client", "index.html")
PROBE = os.path.join(HERE, "verify-sticky.mjs")

MUTATIONS = [
    # The band is the fix. Without position: sticky the two filter rows scroll away again, which is
    # the report this whole change answers.
    ("the band is not pinned at all",
     "      .filter-sticky {\n        position: sticky;\n        top: 0;",
     "      .filter-sticky {\n        top: 0;",
     "the filter band pins to the top of the page"),

    # The band sits over the ledger now. Opaque is the whole difference between a band and a hole.
    ("the band goes transparent over the ledger",
     "      .filter-sticky {\n        position: sticky;\n        top: 0;\n        z-index: 6;\n        background: var(--mcode-bg);\n",
     "      .filter-sticky {\n        position: sticky;\n        top: 0;\n        z-index: 6;\n",
     "the filter band is opaque"),

    # The old half-fixed state: the type row sticks, the 异常 row scrolls out from under it.
    ("the type row pins itself again, leaving the 异常 row behind",
     "      .traj-controls {\n        display: flex;",
     "      .traj-controls {\n        position: sticky;\n        top: 0;\n        display: flex;",
     "the band is the only pinned element for the two filter rows"),

    # The band ends before the 异常 row, so the anomaly axis is back on its own.
    ("the 异常 row leaves the band",
     "        <div class=\"anomaly-bar\" id=\"anomaly-bar\">",
     "        </div>\n        <div class=\"anomaly-bar\" id=\"anomaly-bar\">",
     "both filter rows ship inside one sticky band"),

    # Markup and stylesheet name the same thing in two places. If they drift, the rule still parses
    # and the element still has an id, and nothing is pinned at all.
    ("the band's class drifts from the rule that pins it",
     "      <div class=\"filter-sticky\" id=\"filter-sticky\">",
     "      <div class=\"filter-band\" id=\"filter-sticky\">",
     "the band element ships the class the stylesheet pins"),

    # The number the measurement replaced. It was correct for a layout without the 异常 row.
    ("the strip pins at a written-down constant again",
     "        top: var(--sticky-band-h, 32px);\n",
     "        top: 32px;\n",
     "the strip pins below the band it measures, not below a constant"),

    ("the window bar forgets the band above it",
     "        top: calc(var(--sticky-band-h, 32px) + var(--sticky-overview-h, 51px));\n",
     "        top: calc(var(--sticky-overview-h, 51px));\n",
     "the window bar pins below the band and the strip"),

    ("a turn head forgets the window bar",
     "        top: calc(var(--sticky-band-h, 32px) + var(--sticky-overview-h, 51px)\n          + var(--sticky-window-h, 45px));\n",
     "        top: calc(var(--sticky-band-h, 32px) + var(--sticky-overview-h, 51px));\n",
     "a turn head pins below the band, the strip and the window bar"),

    # Everything pinned over the ledger has to cover it. The rows underneath are transparent.
    ("the strip goes transparent",
     "        height: 50px;\n        overflow: hidden;\n        background: var(--mcode-surface-muted);\n",
     "        height: 50px;\n        overflow: hidden;\n",
     "the overview strip is opaque"),

    ("the window bar goes transparent",
     "        z-index: 3;\n        padding: 8px 16px;\n        background: var(--mcode-bg);\n        border-bottom: 1px solid var(--mcode-border);\n      }\n",
     "        z-index: 3;\n        padding: 8px 16px;\n        border-bottom: 1px solid var(--mcode-border);\n      }\n",
     "the window bar is opaque"),

    ("a pinned turn head goes transparent",
     "        border: 0;\n        border-bottom: 1px solid var(--mcode-border);\n        background: var(--mcode-bg-secondary);\n",
     "        border: 0;\n        border-bottom: 1px solid var(--mcode-border);\n",
     "the turn head is opaque"),

    # The stub heights are 137 / 65 / 57 for exactly this reason: no constant in the file is any of
    # them, so a version that writes a number instead of measuring cannot pass.
    ("the band height is written down instead of measured",
     "        var band = dom.filterSticky.offsetHeight;",
     "        var band = 32;",
     "the measured band height is the one that gets written"),

    ("the strip is measured from the band",
     "        var overview = dom.overview.offsetHeight;",
     "        var overview = dom.filterSticky.offsetHeight;",
     "the measured strip height is the one that gets written"),

    # Nothing reads this variable any more, so the stylesheet silently falls back to 45px.
    ("the window bar height is measured but never written",
     "        root.setProperty('--sticky-window-h', dom.windowBar.offsetHeight + 'px');\n",
     "",
     "every pinned offset is written by the measurement, not by the stylesheet"),

    # A band that is never bound measures nothing: the function stands down, all three offsets fall
    # back to their constants, and nothing anywhere reports an error.
    ("the band element is no longer found",
     "        dom.filterSticky = document.getElementById('filter-sticky');\n",
     "",
     "every band the measurement reads is bound to an element the markup ships"),

    # The quieter version of the same thing: an id that is not on the page.
    ("the band is looked up by an id that is not there",
     "        dom.filterSticky = document.getElementById('filter-sticky');",
     "        dom.filterSticky = document.getElementById('filter-band');",
     "every band the measurement reads is bound to an element the markup ships"),

    # Reads a null off the page instead of standing down.
    ("the measurement no longer stands down without the band",
     "        if (!dom.filterSticky || !dom.overview || !dom.windowBar) return;",
     "",
     "the measurement stands down when the band is not on the page"),

    # The 异常 note is written by syncAnomalyMode, and it is the note that adds a line to the band.
    ("the bands are measured before the 异常 note is written",
     "        updateHandoffButton();\n"
     "        // Last: it reads the bands the lines above just changed. The 异常 note appears and\n"
     "        // disappears here, so measuring before this point would pin the bands to yesterday's\n"
     "        // height and leave the window bar overlapping the strip above it.\n"
     "        syncStickyOffsets();\n",
     "        syncStickyOffsets();\n        updateHandoffButton();\n",
     "the heights are measured once the rows are drawn, not before"),
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
for title, old, new, expect in MUTATIONS:
    hits = original.count(old)
    if hits != 1:
        raise SystemExit("FAIL  anchor for %r matched %d times" % (title, hits))
    try:
        io.open(CLIENT, "w", encoding="utf-8", newline="").write(original.replace(old, new, 1))
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
