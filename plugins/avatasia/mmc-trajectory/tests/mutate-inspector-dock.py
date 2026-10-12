"""Mutation control for the inspector's three dock states.

A guard that cannot fail is not a guard. Each mutation below breaks one of the rules in
verify-inspector-dock.mjs the way it would actually break in the file, and requires that guard to
fail with the right reason before the file is restored byte for byte.

Three of them are the ones a reader should be least able to guess, because all three leave the file
looking like it works:

  - the pinned test loosened from a bounded comparison to `>=`. A panel that has not been scrolled
    to yet also has its bottom below the viewport, so the panel shrinks into half height in front of
    the reader.
  - the second reference (main.columns) added back. The panel is a child of that container, so
    pinning the panel pins it too and the conjunction is false in every state — the panel then never
    docks at all, which is the opposite failure from the one it was added to fix.
  - offsetTop read as the panel's position. The ledger is virtualised, so offsetTop is ~7,300px
    short of the real layout position and the rule fires on scroll position instead of on the panel
    leaving.

A note on the two that change a *count* rather than a behaviour: removing the `else if` leaves
`if (pinned) dockInspector();`, which looks like it can still unpin. It cannot, and the guard that
says so is the only place that is written down.
"""
import io
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CLIENT = os.path.join(ROOT, "miniapp", "client", "index.html")
PROBE = os.path.join(HERE, "verify-inspector-dock.mjs")

MUTATIONS = [
    # ---- the CSS, in the media query that makes the feature exist ----

    ("the panel is not sticky at all",
     "        #inspector-panel {\n          position: sticky;\n",
     "        #inspector-panel {\n          position: static;\n",
     "on a narrow screen the panel sticks to the bottom of the viewport"),

    ("the panel sticks to the top instead of the bottom",
     "          position: sticky;\n          bottom: 0;\n",
     "          position: sticky;\n          top: 0;\n",
     "on a narrow screen the panel sticks to the bottom of the viewport"),

    ("half height is written down instead of being half",
     "          max-height: var(--inspector-dock-h);\n",
     "          max-height: 420px;\n",
     "half height is a cap on the panel, not a cap on its content"),

    ("the half-height panel grows instead of scrolling",
     "          max-height: var(--inspector-dock-h);\n          overflow-y: auto;\n",
     "          max-height: var(--inspector-dock-h);\n",
     "the half-height panel scrolls its own content"),

    # The third state has to be a different number, or 「完全展开」 and 「半高」 are the same panel
    # with two names.
    ("fully expanded is capped by the half-height number",
     "          max-height: var(--inspector-full-h, 70vh);\n",
     "          max-height: var(--inspector-dock-h);\n",
     "fully expanded is capped by a different number than half height"),

    ("the half-height number stops being declared",
     "        --inspector-dock-h: 50vh;\n",
     "",
     "the half-height number is declared, not left to fall back"),

    ("half height becomes a fixed pixel count",
     "        --inspector-dock-h: 50vh;\n",
     "        --inspector-dock-h: 420px;\n",
     "half height is a share of the viewport, and the share is written down"),

    # Ledger rows are background: transparent, so a pinned panel that stops covering them shows
    # them through — the same reason the sticky band needs an opaque background.
    ("the docked panel goes transparent over the rows under it",
     "          border-top: 1px solid var(--mcode-border);\n"
     "          background: var(--mcode-surface);\n",
     "          border-top: 1px solid var(--mcode-border);\n",
     "the docked panel paints a background over the rows under it"),

    # The docking query has to *be* the single-column breakpoint, and both directions are defects.
    # The narrower one is the version that shipped: 767 against a collapse at 1080, leaving a band
    # where the panel is below the ledger and nothing pins it, which reads as "not here" rather than
    # "broken" — and it survived review because the feature was only ever measured at 420px.
    ("docking starts below the width where the columns collapse",
     "       * than broken. Above 1080px the inspector is its own column and must not dock at all. */\n\n"
     "      @media (max-width: 1080px) {\n",
     "       * than broken. Above 1080px the inspector is its own column and must not dock at all. */\n\n"
     "      @media (max-width: 767px) {\n",
     "docking covers every width at which the inspector sits below the ledger"),

    ("docking starts above the width where the columns collapse",
     "       * than broken. Above 1080px the inspector is its own column and must not dock at all. */\n\n"
     "      @media (max-width: 1080px) {\n",
     "       * than broken. Above 1080px the inspector is its own column and must not dock at all. */\n\n"
     "      @media (max-width: 1400px) {\n",
     "docking never engages while the inspector is still beside the ledger"),

    # The two halves have to name the same width. The guard derives the breakpoint from the
    # stylesheet, so changing only the script's copy is invisible to every rule above.
    ("the script docks at widths the stylesheet does not",
     "var INSPECTOR_DOCK_QUERY = '(max-width: 1080px)';",
     "var INSPECTOR_DOCK_QUERY = '(max-width: 767px)';",
     "the script and the stylesheet dock at the same width"),

    # ---- markup: two names in two places ----

    ("the handle ships visible, so it offers to expand a panel that is not pinned",
     " aria-label=\"完全展开检视\" title=\"完全展开检视\" hidden>",
     " aria-label=\"完全展开检视\" title=\"完全展开检视\">",
     "the handle ships hidden, because in flow there is nothing to expand"),

    ("the handle stops being one of the existing section toggles",
     "class=\"section-toggle\" id=\"inspector-toggle\"",
     "class=\"dock-handle\" id=\"inspector-toggle\"",
     "the handle ships inside the panel head, as one of the existing section toggles"),

    ("the handle names only one direction of the cycle",
     "aria-label=\"完全展开检视\" title=\"完全展开检视\" hidden>",
     "aria-label=\"切换检视\" title=\"切换检视\" hidden>",
     "the handle names the action it performs, for both directions of the cycle"),

    ("the inspector panel loses the class every other section uses",
     "<section class=\"panel\" id=\"inspector-panel\"",
     "<section class=\"aside\" id=\"inspector-panel\"",
     "the panel is a .panel, the same block every other section uses"),

    # ---- the three states ----

    ("the panel starts pinned instead of in the document",
     "        inspectorDock: 'flow',\n",
     "        inspectorDock: 'docked',\n",
     "the panel starts in the document, not pinned"),

    ("the exit that pins the panel stops naming the pinned state",
     "        state.inspectorDock = 'docked';\n        applyInspectorDock();\n      }\n\n"
     "      function resetInspectorDock() {",
     "        state.inspectorDock = 'full';\n        applyInspectorDock();\n      }\n\n"
     "      function resetInspectorDock() {",
     "one exit pins the panel"),

    ("the exit that unpins stops putting the panel back in the document",
     "      function resetInspectorDock() {\n        state.inspectorDock = 'flow';\n",
     "      function resetInspectorDock() {\n        state.inspectorDock = 'docked';\n",
     "one exit puts the panel back in the document"),

    ("an exit changes the field without repainting",
     "        state.inspectorDock = 'docked';\n        applyInspectorDock();\n",
     "        state.inspectorDock = 'docked';\n",
     "both exits repaint the panel before returning"),

    # A fourth writer is how a three-state field quietly grows a fourth state.
    ("a fourth place writes the dock state",
     "      function wire() {\n",
     "      function wire() {\n        state.inspectorDock = 'docked';\n",
     "nothing writes the dock state from outside the three declared exits"),

    # ---- the handle contract ----

    ("the handle stays on screen when the panel is not pinned",
     "        toggle.hidden = !narrow || !docked;\n",
     "        toggle.hidden = !narrow;\n",
     "the handle is hidden unless the panel is pinned"),

    ("the handle stops reporting which pinned state it is in",
     "        var expanded = state.inspectorDock === 'full';\n"
     "        toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');\n",
     "        toggle.setAttribute('aria-expanded', 'true');\n",
     "the handle reports which of the two pinned states it is in"),

    ("only one of the two labels is written",
     "        var label = expanded ? '收起到半高' : '完全展开检视';\n",
     "        var label = '完全展开检视';\n",
     "the two pinned states are named by one rule, so the labels cannot disagree"),

    ("the expanded height stops being measured",
     "          var available = Math.max(240, Math.round(window.innerHeight - band - overview));\n",
     "          var available = 480;\n",
     "the expanded height is measured from the window and the pinned offsets"),

    # 100vh is not the reader's height in a host iframe; client-check bans it everywhere else and
    # this is where it would have been most tempting.
    ("the expanded height is written in viewport units",
     "dom.inspectorPanel.style.setProperty('--inspector-full-h', available + 'px');",
     "dom.inspectorPanel.style.setProperty('--inspector-full-h', available + 'vh');",
     "the expanded height is written in pixels"),

    # ---- the scroll decision ----

    # The one that shows up as working code. `>=` is true both above and below the fold.
    ("the pinned test loosened to fit both sides of the fold",
     "var pinned = Math.abs(pr.bottom - window.innerHeight) <= 1;",
     "var pinned = pr.bottom >= window.innerHeight;",
     "the panel counts as pinned only when its bottom equals the viewport bottom"),

    # The reference that was added to fix the one above, and made the panel never dock at all.
    ("the container is consulted as a second reference again",
     "var pinned = Math.abs(pr.bottom - window.innerHeight) <= 1;",
     "var pinned = Math.abs(pr.bottom - window.innerHeight) <= 1\n"
     "          && dom.columns.getBoundingClientRect().bottom < window.innerHeight - 1;",
     "no second reference is consulted: the panel is a child of anything it would be compared to"),

    # Virtualised ledger: offsetTop is ~7,300px short, so this fires on scroll position.
    ("the decision reads the panel's position in the document",
     "var pr = panel.getBoundingClientRect();",
     "var pr = panel.getBoundingClientRect();\n        var docTop = panel.offsetTop;",
     "the decision does not read the panel's position in the document"),

    # Looks able to unpin. Cannot: without the else there is no path back to flow except the
    # media-query clause, which does not run while the reader is still on a narrow screen.
    ("scrolling back out of the dock state does nothing",
     "        if (pinned) dockInspector();\n"
     "        else if (state.inspectorDock !== 'flow') resetInspectorDock();\n",
     "        if (pinned) dockInspector();\n",
     "scrolling away pins the panel and scrolling back unpins it"),

    ("widening the window leaves the panel stuck at half height",
     "          if (state.inspectorDock !== 'flow') resetInspectorDock();\n          return;",
     "          return;",
     "leaving the narrow layout puts the panel back in the document"),

    # The ledger re-batches as it scrolls, so this fires many times a frame.
    ("the scroll decision is not coalesced",
     "        inspectorDockFrame = window.requestAnimationFrame(function () {\n"
     "          inspectorDockFrame = 0;\n"
     "          updateInspectorDock();\n"
     "        });\n",
     "        updateInspectorDock();\n",
     "the scroll decision coalesces into one frame"),

    # ---- wiring ----

    ("nothing decides the dock state on scroll",
     "        window.addEventListener('scroll', scheduleInspectorDock, { passive: true });\n",
     "",
     "scrolling decides the dock state"),

    ("the scroll listener is not passive",
     "window.addEventListener('scroll', scheduleInspectorDock, { passive: true });",
     "window.addEventListener('scroll', scheduleInspectorDock);",
     "the scroll listener is passive, because nothing here scrolls the page from inside the handler"),

    # A resize moves the viewport bottom out from under a pinned panel, and is also the only thing
    # that notices the media query stopped matching.
    ("a resize no longer re-decides the dock state",
     "        window.addEventListener('resize', scheduleInspectorDock);\n",
     "",
     "a resize re-decides the dock state"),

    ("a page loaded scrolled into the middle of a ledger is wrong until the reader moves",
     "        applyInspectorDock();\n\n        dom.followBtn",
     "        dom.followBtn",
     "the dock state is decided once at wire time"),

    ("pressing the handle changes the field but not the panel",
     "          state.inspectorDock = state.inspectorDock === 'full' ? 'docked' : 'full';\n"
     "          applyInspectorDock();\n",
     "          state.inspectorDock = state.inspectorDock === 'full' ? 'docked' : 'full';\n",
     "pressing the handle moves between the two pinned states and repaints"),
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

survivors = len(MUTATIONS) - sum(1 for c in caught if c)
print("%d/%d mutations caught, %d survived" % (sum(1 for c in caught if c), len(MUTATIONS), survivors))
if not (base_ok and after_ok and restored == original and survivors == 0):
    sys.exit(1)