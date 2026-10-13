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

    # D40 gave the file a second `calc(var(--sticky-band-h…) + var(--sticky-overview-h…))`, ten spaces
    # in and inside a media query. The bare 8-space line this used to anchor on became a PREFIX of it
    # and matched twice, so the harness refused rather than mutating an arbitrary one of the two.
    # §8.1: an anchor has to be unambiguous about which line it means, not just about which text.
    # The `z-index: 3` below is what makes this one the window bar and not the inspector.
    ("the window bar forgets the band above it",
     "        top: calc(var(--sticky-band-h, 32px) + var(--sticky-overview-h, 51px));\n        z-index: 3;\n",
     "        top: calc(var(--sticky-overview-h, 51px));\n        z-index: 3;\n",
     "the window bar pins below the band and the strip"),

    ("a turn head forgets the window bar",
     "        top: calc(var(--sticky-band-h, 32px) + var(--sticky-overview-h, 51px)\n          + var(--sticky-window-h, 45px));\n",
     "        top: calc(var(--sticky-band-h, 32px) + var(--sticky-overview-h, 51px));\n",
     "a turn head pins below the band, the strip and the window bar"),

    # Everything pinned over the ledger has to cover it, and it has to cover it itself. These two
    # mutations are the pair the guard used to confuse: it checked the plot and called that the strip
    # being opaque, so the box above it could go transparent and the window bar scrolled up through
    # the seam between them as a clipped line of its own text. Each is now caught by the rule that
    # names its own element, because neither one stands in for the other.
    ("the pinned strip box goes transparent",
     "      .overview {\n        position: sticky;\n        top: var(--sticky-band-h, 32px);\n        z-index: 4;\n        background: var(--mcode-bg);\n",
     "      .overview {\n        position: sticky;\n        top: var(--sticky-band-h, 32px);\n        z-index: 4;\n",
     "the pinned strip owns its background"),

    ("the strip's lanes area goes transparent",
     "        height: 50px;\n        overflow: hidden;\n        background: var(--mcode-surface-muted);\n",
     "        height: 50px;\n        overflow: hidden;\n",
     "the strip's lanes area is painted"),

    # The strip is the one pinned box that sits directly on another. If it dropped below the window
    # bar, an opaque sibling could no longer cover for it — which is the assumption the two rules
    # above are resting on.
    ("the pinned strip drops behind the window bar it covers",
     "        z-index: 4;\n        background: var(--mcode-bg);\n",
     "        z-index: 2;\n        background: var(--mcode-bg);\n",
     "every pinned strip has something scrolling into its seam"),

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

    # Where the measurement happens, and who is allowed to trigger it. The 异常 note is written by
    # syncAnomalyMode and it is the note that adds a line to the band, so the order of the two
    # decides whether the strips below are pinned at the height the band had before the reader
    # changed anything.
    ("the ledger stops measuring the band",
     "          // and emptying the ledger mid-flight is not a reason to move a pinned strip.\n"
     "          syncStickyOffsets();\n",
     "          // and emptying the ledger mid-flight is not a reason to move a pinned strip.\n",
     "the heights are measured at the one exit every filter passes through"),

    ("the measurement moves off the ledger's last line",
     "          restoreRowAnchor(anchor, scrollY);\n          // Before the measurement",
     "          syncStickyOffsets();\n          restoreRowAnchor(anchor, scrollY);\n          // Before the measurement",
     "the heights are measured at the one exit every filter passes through"),

    # A second call site is the shape that let the eight filter writers nobody was thinking about go
    # unmeasured in the first place.
    ("the measurement is taken twice on the render path",
     "        updateHandoffButton();\n      }\n\n      function renderGeneration() {",
     "        updateHandoffButton();\n        syncStickyOffsets();\n      }\n\n      function renderGeneration() {",
     "the measurement has exactly one call site on the render path"),

    ("the band note is written after the heights are measured",
     "        syncAnomalyMode(anomaly);\n"
     "        syncAnomalyButtons(anomaly);\n"
     "        renderOverview();\n"
     "        renderLedger();\n",
     "        syncAnomalyButtons(anomaly);\n"
     "        renderOverview();\n"
     "        renderLedger();\n"
     "        syncAnomalyMode(anomaly);\n",
     "the band note is written before the heights are measured"),

    # Nothing re-measured when the window changed shape. On a session whose payload has stopped
    # growing every poll is a 304 and render() is never called, so a resize that wrapped the type
    # row left the strips pinned at the old width until new records arrived.
    ("a window resize measures nothing",
     "        window.addEventListener('resize', scheduleStickyOffsets);\n\n",
     "",
     "a window resize re-measures the band"),

    ("the resize is registered against a handler that measures nothing",
     "        stickyFrame = window.requestAnimationFrame(function () {\n"
     "          stickyFrame = null;\n"
     "          syncStickyOffsets();\n"
     "        });\n",
     "        stickyFrame = window.requestAnimationFrame(function () {\n"
     "          stickyFrame = null;\n"
     "        });\n",
     "a resize reaches the measurement it was registered for"),

    # Correct but a layout thrash: each measurement reads three offsetHeights, and a window drag
    # fires `resize` continuously.
    ("a resize is measured on every event instead of once per frame",
     "        window.addEventListener('resize', scheduleStickyOffsets);\n",
     "        window.addEventListener('resize', syncStickyOffsets);\n",
     "a resize measures once per frame, not once per event"),
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
