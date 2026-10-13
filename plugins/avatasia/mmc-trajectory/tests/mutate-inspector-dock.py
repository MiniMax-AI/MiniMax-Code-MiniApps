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
    # The selector is in the anchor because D32 put the same declaration on the base rule too, and
    # a bare property line now matches twice. Anchoring a rule by its property alone is what makes
    # this kind of edit look like a silent anchor drift.
    ("fully expanded is capped by the default docked number",
     "#inspector-panel.is-inspector-full {\n          max-height: var(--inspector-full-h, 70vh);\n",
     "#inspector-panel.is-inspector-full {\n          max-height: var(--inspector-dock-h);\n",
     "fully expanded is capped by a different number than half height"),

    # One expect name below used to be `both pinned states cap the panel rather than fixing its
    # height`. D32 replaced that assertion, so the mutation was reported as SURVIVED while three
    # assertions were reporting it by other names -- one of them the pre-existing mechanism rule.
    # A survivor here means "the named witness is gone", not "the guard is blind". Read the guard's
    # own output before believing either.

    # ---- D32: sticky and cap travel together, or the panel leaves its grid row ----
    #
    # A sticky-bottom element taller than the scrollport has no legal position: the browser slides
    # it up by the difference and it covers the ledger. Measured 2026-10-13 at 863x803, one record
    # selected: layout position document y=8302, rendered y=885, 972px tall in a 706px viewport.
    # The grid was never wrong. So the cap has to live on the rule that hands out `position: sticky`.

    ("the sticky panel stops being capped",
     "          max-height: var(--inspector-full-h, 70vh);\n          overflow-y: auto;\n        }\n\n        /* Two fifths by default",
     "          overflow-y: auto;\n        }\n\n        /* Two fifths by default",
     "the rule that makes the panel sticky-bottom is the rule that caps it"),

    ("the document state is capped by a number of its own",
     "          max-height: var(--inspector-full-h, 70vh);\n          overflow-y: auto;\n        }\n\n        /* Two fifths by default",
     "          max-height: 92vh;\n          overflow-y: auto;\n        }\n\n        /* Two fifths by default",
     "in the document and fully expanded are bounded by the same number"),

    ("the sticky panel is given a fixed height instead of a ceiling",
     "          max-height: var(--inspector-full-h, 70vh);\n          overflow-y: auto;\n        }\n\n        /* Two fifths by default",
     "          height: var(--inspector-full-h, 70vh);\n          overflow-y: auto;\n        }\n\n        /* Two fifths by default",
     "nothing forces the panel taller than its own content"),

    ("the two-fifths fallback stops being declared",
     "        --inspector-dock-h: 40vh;\n",
     "",
     "the two-fifths fallback is declared, not left to fall back"),

    ("the docked height becomes a fixed pixel count",
     "        --inspector-dock-h: 40vh;\n",
     "        --inspector-dock-h: 420px;\n",
     "the docked height is a share of the viewport, and the share is written down"),

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
     "      function dockInspector() {\n        if (state.inspectorDock !== 'flow') return;\n"
     "        state.inspectorDock = 'docked';\n        applyInspectorDock();\n",
     "      function dockInspector() {\n        if (state.inspectorDock !== 'flow') return;\n"
     "        state.inspectorDock = 'docked';\n",
     "both exits repaint the panel before returning"),

    # `height` instead of `max-height` is the change that looks right in review and pads a short
    # panel out to a quarter of the window with a blank band inside it. It cannot be caught by a
    # measurement today — the shortest record is 752px of content against a 250px quarter — so this
    # is the case where the guard has to protect the mechanism rather than an outcome.
    ("the docked panel is given a fixed height instead of a cap",
     "          max-height: var(--inspector-dock-h);\n",
     "          height: var(--inspector-dock-h);\n",
     "half height is a cap on the panel, not a cap on its content"),

    ("a floor is added under the cap, padding short panels out",
     "          max-height: var(--inspector-dock-h);\n",
     "          max-height: var(--inspector-dock-h);\n          min-height: var(--inspector-dock-h);\n",
     "nothing forces the panel taller than its own content"),

    # D27. This one deletes the rule that makes the grip reachable, which is the whole defect: the
    # base rule's `display: none` becomes final, `hidden` loses to it, and the strip keeps a 0x0 box
    # on every screen at every width. It is the mutation that reproduces chli's 「支持resize,没做」
    # exactly, and the guard that has to catch it is the one that asks whether anything undoes the
    # rule keeping it invisible rather than whether its properties are present.
    ("the grip can no longer be turned on at all",
     "        #inspector-panel .inspector-resize:not([hidden]) {\n          display: block;\n        }\n",
     "",
     "a rule exists that can turn the grip back on"),

    # The same defect wearing a different hat: the counterpart rule still exists but is keyed on a
    # class nothing writes, so it still never matches. A guard that only looks for the selector's
    # presence passes this; one that looks for the `hidden` pairing does not.
    ("the grip is shown by a class nothing ever sets",
     "        #inspector-panel .inspector-resize:not([hidden]) {\n",
     "        #inspector-panel .inspector-resize.is-open {\n",
     "the grip is shown by removing the very attribute that hides it"),

    # D28. The share drifts back to a quarter: the two numeric assertions stop agreeing with each
    # other only if both are read, and the stylesheet fallback is what catches it, because 40vh no
    # longer describes the same promise as INSPECTOR_DOCK_SHARE.
    ("the docked height goes back to a quarter of the window",
     "var INSPECTOR_DOCK_SHARE = 0.4;",
     "var INSPECTOR_DOCK_SHARE = 0.25;",
     "the default docked height is two fifths of the measured window"),

    # The stylesheet fallback is left behind instead — the other direction of the same drift, and
    # the one that makes the panel jump on first paint before the first measurement lands.
    ("the stylesheet fallback is left at a quarter",
     "        --inspector-dock-h: 40vh;\n",
     "        --inspector-dock-h: 25vh;\n",
     "the stylesheet fallback agrees with the measured share"),

    # The single writer is undone: one caller computes the share again and the other keeps calling
    # the helper. Both paths still produce a number, so nothing looks wrong until the two numbers
    # are different — which is the entire reason the helper exists.
    ("a second place computes the default height by hand",
     "            dockH = inspectorDefaultDockHeight();\n",
     "            dockH = Math.round(window.innerHeight / 4);\n",
     "the default docked height is computed once and both readers call it"),

    # A sixth writer is how a three-state field quietly grows a fourth state. Inserted into wire(),
    # where nothing else writes the field, so it is a genuinely new writer.
    ("a sixth place writes the dock state",
     "      function wire() {\n",
     "      function wire() {\n        state.inspectorDock = 'docked';\n",
     "nothing writes the dock state from outside the five declared exits"),

    # ---- visibility: the panel is the selection ----

    # The empty shell is the bug this removes: a panel with nothing in it, in the way of the
    # footer, on every page load before the reader has clicked anything.
    ("the panel stays on the page with nothing selected",
     "        if (dom.inspectorPanel) dom.inspectorPanel.hidden = !hasSelection;\n",
     "        if (dom.inspectorPanel) dom.inspectorPanel.hidden = false;\n",
     "the panel is on the page only while a record is selected"),

    ("a second flag decides whether the panel is visible",
     "        var hasSelection = state.selectedId !== null && state.selectedId !== undefined;\n",
     "        var hasSelection = state.selectedId !== null && !state.inspectorVisible;\n"
     "        state.inspectorVisible = false;\n",
     "visibility is derived from the selection field, not from a second flag"),

    # Decided in the click handler instead: every other way the selection changes (a poll that
    # drops the record, the generation picker) then leaves the panel showing what is not selected.
    ("losing the selection is decided away from the one exit",
     "        applyInspectorDock();\n\n        if (!entry) {",
     "        if (!entry) {",
     "one exit re-decides the panel's visibility"),

    # ---- the docked height ----

    ("the docked height is half the window again",
     "            dockH = inspectorDefaultDockHeight();\n",
     "            dockH = Math.round(window.innerHeight / 2);\n",
     "the default docked height is computed once and both readers call it"),

    ("the docked height is left to the stylesheet",
     "          dom.inspectorPanel.style.setProperty('--inspector-dock-h', dockH + 'px');\n",
     "",
     "the docked height is written in pixels, like every other offset here"),

    # A drag that can go past what the pinned strips leave buries them; one that goes below the
    # panel head hides the handle that collapses the panel again.
    ("the docked height is clamped at neither end",
     "          dockH = Math.min(Math.max(Math.round(dockH), INSPECTOR_MIN_DOCK_H), panelMax);\n",
     "          dockH = Math.round(dockH);\n",
     "the docked height is clamped at both ends"),

    # A running total rounds its way off over a long drag, and cannot be resumed if a move is lost.
    ("a drag accumulates instead of measuring from where it started",
     "        var next = inspectorResizeDrag.anchorH + (inspectorResizeDrag.anchorClientY - event.clientY);\n",
     "        var next = (state.inspectorDockH || 0) + (inspectorResizeDrag.anchorClientY - event.clientY);\n",
     "a drag is measured from the height the panel had, not accumulated"),

    # Without the id check a second finger on the panel resizes it while the reader is only
    # scrolling with the first.
    ("any pointer can drive the resize",
     "        if (inspectorResizeDrag.pointerId !== event.pointerId) return;\n        // The panel is pinned to the bottom",
     "        // The panel is pinned to the bottom",
     "a drag is driven only by the pointer that started it"),

    # 'full' means no cap, so a drag that leaves the panel there is a grip that does nothing in the
    # state where it is most visible.
    ("a drag leaves the panel fully expanded",
     "        state.inspectorDockH = next;\n        state.inspectorDock = 'docked';\n"
     "        applyInspectorDock();\n",
     "        state.inspectorDockH = next;\n        applyInspectorDock();\n",
     "a drag settles the panel into the docked state rather than leaving it expanded"),

    # ---- the grip ----

    # `touch-action` is what makes this usable at all on the devices a narrow layout is a phone.
    ("the grip scrolls the page instead of resizing",
     "          touch-action: none;\n",
     "          touch-action: pan-y;\n",
     "a vertical drag on the grip resizes instead of scrolling the page"),

    # Below the panel's top edge rather than on it: the edge is the bottom of this strip, so a grip
    # centred on it sits half inside the content the reader is trying to scroll.
    ("the grip sits on the edge that does not move",
     "          top: -7px;\n",
     "          top: 7px;\n",
     "the grip is on the edge that moves when the panel is pinned to the bottom"),

    # A grip that does nothing in flow is worse than no grip: it promises a control that has no
    # effect.
    ("the grip is offered even when the panel is not pinned",
     "        if (dom.inspectorResize) dom.inspectorResize.hidden = !(narrow && docked);\n",
     "        if (dom.inspectorResize) dom.inspectorResize.hidden = false;\n",
     "the grip is only offered while the panel is pinned"),

    # A drag that ends because the browser took the capture leaves the drag object alive, and every
    # later pointermove then resizes a panel nobody is touching.
    ("a cancelled drag is never released",
     "        dom.inspectorResize.addEventListener('pointercancel', onInspectorResizeUp);\n",
     "",
     "the grip listens for pointercancel"),

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
     "          var panelMax = Math.max(\n            INSPECTOR_MIN_DOCK_H,\n"
     "            Math.round(window.innerHeight - band - overview - ledgerReserve)\n          );\n",
     "          var panelMax = 480;\n",
     "the expanded height is measured from the window and the pinned offsets"),

    # ---- the ledger keeps its share of the window ----

    # The defect as shipped: the expanded panel ran the full height below the pinned strips and
    # not one ledger row was left on screen.
    ("the expanded panel covers the ledger again",
     "            Math.round(window.innerHeight - band - overview - ledgerReserve)\n",
     "            Math.round(window.innerHeight - band - overview)\n",
     "the ledger share is subtracted from the height the panel may take"),

    ("the ledger keeps a tenth of the window instead of a quarter",
     "var INSPECTOR_LEDGER_SHARE = 0.25;",
     "var INSPECTOR_LEDGER_SHARE = 0.1;",
     "the ledger keeps a quarter of the window"),

    # A drag that can exceed the expanded cap reaches the same defect by another door: the reader
    # pulls the top edge up and the rows disappear, with no state having changed.
    ("a drag can grow past the expanded ceiling",
     "          dockH = Math.min(Math.max(Math.round(dockH), INSPECTOR_MIN_DOCK_H), panelMax);\n",
     "          dockH = Math.max(Math.round(dockH), INSPECTOR_MIN_DOCK_H);\n",
     "expanding and dragging are bounded by the same ceiling"),

    # 100vh is not the reader's height in a host iframe; client-check bans it everywhere else and
    # this is where it would have been most tempting.
    ("the expanded height is written in viewport units",
     "dom.inspectorPanel.style.setProperty('--inspector-full-h', panelMax + 'px');",
     "dom.inspectorPanel.style.setProperty('--inspector-full-h', panelMax + 'vh');",
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

    # ---- the selection is a dock input, and nothing else fires for it ----
    #
    # These three are the ones to guess least easily, because each leaves the file looking like the
    # feature works. The CSS is right, the decision function is right, and the panel does pin itself
    # to the viewport bottom — it just never gets *asked* whether it is pinned.

    ("selecting a record shows the panel without asking how it should sit",
     "        scheduleInspectorDock();\n      }\n",
     "      }\n",
     "the exit that shows the record is the exit that re-decides how it is docked"),

    ("the selection reaches the scheduler but the scheduler stopped deciding",
     "          updateInspectorDock();\n        });",
     "          applyInspectorDock();\n        });",
     "the dock decision is reachable from a change that fires no scroll event"),

    ("the re-decision is also made in the branch that has no panel to measure",
     "          dom.panels.appendChild(panel);\n          return;",
     "          dom.panels.appendChild(panel);\n          scheduleInspectorDock();\n          return;",
     "the empty-selection branch has no panel left to measure"),
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