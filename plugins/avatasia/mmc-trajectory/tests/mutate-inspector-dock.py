"""Mutation control for the inspector's dock states.

A guard that cannot fail is not a guard. Each mutation below breaks one of the rules in
verify-inspector-dock.mjs the way it would actually break in the file, and requires that guard to
fail with the right reason before the file is restored byte for byte.

Three of them are the ones a reader should be least able to guess, because all three leave the file
looking like it works:

  - the pinned test loosened from a bounded comparison to `>=`. A band that has not reached the top
    yet and one that is already there both satisfy it, so the panel pins before the region the
    report is about has arrived.
  - the second reference added back. The panel is a child of main.columns, so pinning the panel
    pins it too and the conjunction is false in every state — the panel then never docks at all,
    which is the opposite failure from the one it was added to fix.
  - offsetTop read as a position. The ledger is virtualised, so offsetTop is ~7,300px short of the
    real layout position and the rule fires on scroll position instead of on the region arriving.

D36 changed the subject of the decision and that changes what those three have to look like, so
every anchor below was re-read rather than re-used: the predicate is now the filter band's top
edge, and the panel is not in the decision at all. A mutation whose anchor was left pointing at
the old shape would have kept reporting a catch for a rule that had stopped being the reason.

D38 split one control into two, and that invalidates the same kind of thing one layer up. Ten
anchors here pointed at `#inspector-toggle`, at `toggle.hidden`, or at a single three-way label
expression, and every one of them would have raised 「anchor matched 0 times」 — the harness refuses
rather than reporting a catch for a rule that is no longer the reason. Each was re-read against the
shipped file rather than re-worded.

Two of the new ones are the ones to guess least easily:

  - `setInspectorDock` gaining `if (state.inspectorDock === next) return;`. That is a correct-looking
    optimisation and it freezes the panel halfway through every drag, because the drag calls it with
    'docked' on each pointermove. Nothing else in the file changes.
  - the expand control's glyph being left to `.section-toggle`'s disclosure rotation. The button
    legitimately carries `aria-expanded`, so the rotation rule matches it, and the chevron points
    sideways whenever the panel is at half height — which is the state it spends most of its time in.

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


# Anchors for the header rule at the top level. Note the explicit newlines: adjacent Python string
# literals concatenate with NOTHING between them, so a constant written as one literal per line
# without them collapses into a single line and then matches nothing in the file.
HEAD_RULE = (
    "      #inspector-panel > .panel-head {\n"
    "        position: sticky;\n"
    "        top: 0;\n"
    "        z-index: 2;\n"
    "        background: var(--mcode-surface);\n"
    "      }"
)

# Appended straight after HEAD_RULE, so that rule closing brace sits immediately before the bare
# selector — which is the shape `bareHeadSticky` looks for.
BARE_HEAD = (
    "\n"
    "      .panel-head {\n"
    "        position: sticky;\n"
    "        top: 0;\n"
    "      }"
)

DOCK_RULE = (
    "        #inspector-panel {\n"
    "          max-height: var(--inspector-full-h, 70vh);\n"
    "          overflow-y: auto;\n"
    "        }"
)

# A second copy of the header rule, indented as if it still lived inside the dock query.
DOCK_HEAD_COPY = (
    "\n"
    "        #inspector-panel > .panel-head {\n"
    "          position: sticky;\n"
    "          top: 0;\n"
    "          z-index: 2;\n"
    "          background: var(--mcode-surface);\n"
    "        }"
)

WIDE_OVERFLOW = (
    "          max-height: var(--inspector-wide-h, 70vh);\n"
    "          overflow-y: auto;"
)


# ---- D42 anchors. The first three are the shipped shapes verbatim; the fourth is the one
# reader D42 introduced, and the mutation that proves it is the only one.
NARROW_WRITER = "        if (dom.inspectorPanel && narrow) {"

WIDE_WRITER = ("        if (!window.matchMedia(INSPECTOR_DOCK_QUERY).matches) {\n"
               "          root.setProperty('--inspector-wide-h', Math.max(")

UNDERPINS_BODY = "      function inspectorUnderPins() {"

SECOND_READER = ("\n"
                 "      var spill = getComputedStyle(document.documentElement)\n"
                 "        .getPropertyValue('--sticky-band-h');")


# The same ceiling, spelled out the way it was before D42: its own strip reads and its own sum.
CEILING_REDERIVED = (
    "          var root = getComputedStyle(document.documentElement);"
    + "\n"
    + "          var band = parseFloat(root.getPropertyValue('--sticky-band-h')) || 0;"
    + "\n"
    + "          var overview = parseFloat(root.getPropertyValue('--sticky-overview-h')) || 0;"
    + "\n"
    + "          var ledgerReserve = Math.max("
    + "\n"
    + "            INSPECTOR_MIN_LEDGER_H,"
    + "\n"
    + "            Math.round(window.innerHeight * INSPECTOR_LEDGER_SHARE)"
    + "\n"
    + "          );"
    + "\n"
    + "          var panelMax = Math.max(INSPECTOR_MIN_DOCK_H, Math.round(window.innerHeight - band - overview - ledgerReserve));")
CEILING_BODY = ("          var ledgerReserve = Math.max(\n"
                 "            INSPECTOR_MIN_LEDGER_H,\n"
                 "            Math.round(window.innerHeight * INSPECTOR_LEDGER_SHARE)\n"
                 "          );\n"
                 "          var panelMax = Math.max(INSPECTOR_MIN_DOCK_H, inspectorUnderPins() - ledgerReserve);")
MUTATIONS = [
    # ---- the CSS, in the media query that makes the feature exist ----

    # D36 re-anchored both of these. `position: sticky` used to be on the BASE rule, which is the
    # defect itself: `bottom: 0` pins the BOTTOM edge, so it only means 「stay reachable」 while the
    # panel is shorter than the scrollport, and taller than that the browser slides it out of its
    # grid row. Measured 2026-10-13 at 897x858: layout position document y=8250 (after the ledger,
    # correct), rendered document y=858 — 7392px up and in FRONT of the ledger at 959. So sticky now
    # lives on the three states that are pinned and the base rule declares none, which is why these
    # two are anchored inside that rule rather than on the panel.

    ("the panel is not sticky at all",
     "        #inspector-panel.is-inspector-folded {\n          position: sticky;\n",
     "        #inspector-panel.is-inspector-folded {\n          position: static;\n",
     "the three pinned states stick to the bottom of the viewport"),

    ("the panel sticks to the top instead of the bottom",
     "        #inspector-panel.is-inspector-folded {\n          position: sticky;\n          bottom: 0;\n",
     "        #inspector-panel.is-inspector-folded {\n          position: sticky;\n          top: 0;\n",
     "the three pinned states stick to the bottom of the viewport"),

    # The state the reader never asked for, and the one that shipped: re-adding it to the base rule
    # makes every state sticky again while every assertion about the pinned three still passes.
    # This is the whole D36 defect as one edit, so it is the one that must be caught by name.
    ("flow is pinned by default again",
     "        #inspector-panel {\n          max-height: var(--inspector-full-h, 70vh);\n",
     "        #inspector-panel {\n          position: sticky;\n          bottom: 0;\n"
     "          max-height: var(--inspector-full-h, 70vh);\n",
     "flow is not pinned on a narrow screen: no position at all inside the dock query"),

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

    # D36 moved sticky off the base rule, so the three anchors below now end at the pinned-states
    # rule instead of at the 「Two fifths」 comment. The cap itself did not move: it is still on the
    # base rule, because it is a property of every state and not of the pinned ones.

    ("the panel in the document stops being capped",
     "          max-height: var(--inspector-full-h, 70vh);\n          overflow-y: auto;\n"
     "        }\n\n        /* The pinned states, and only these three.",
     "          overflow-y: auto;\n"
     "        }\n\n        /* The pinned states, and only these three.",
     "every state is capped, including the one that is no longer pinned"),

    ("the document state is capped by a number of its own",
     "          max-height: var(--inspector-full-h, 70vh);\n          overflow-y: auto;\n"
     "        }\n\n        /* The pinned states, and only these three.",
     "          max-height: 92vh;\n          overflow-y: auto;\n"
     "        }\n\n        /* The pinned states, and only these three.",
     "in the document and fully expanded are bounded by the same number"),

    ("the panel in the document is given a fixed height instead of a ceiling",
     "          max-height: var(--inspector-full-h, 70vh);\n          overflow-y: auto;\n"
     "        }\n\n        /* The pinned states, and only these three.",
     "          height: var(--inspector-full-h, 70vh);\n          overflow-y: auto;\n"
     "        }\n\n        /* The pinned states, and only these three.",
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

    # ---- markup: two controls, two names in two places ----
    #
    # D38 replaced one button with two, so every anchor in this block used to name 「the handle」 and
    # a mutation that changed one control while the assertion was satisfied by the other would have
    # reported a catch for the wrong reason. Each control now gets its own mutation for each rule.

    ("the minimize control ships visible, so it offers a height change to a panel in the document",
     " aria-label=\"折叠到最小\" title=\"折叠到最小\" hidden>",
     " aria-label=\"折叠到最小\" title=\"折叠到最小\">",
     "both controls ship hidden, because in flow there is no height to change"),

    ("the expand control ships visible, so a panel in the document offers to expand",
     " aria-label=\"完全展开检视\" title=\"完全展开检视\" hidden>",
     " aria-label=\"完全展开检视\" title=\"完全展开检视\">",
     "both controls ship hidden, because in flow there is no height to change"),

    ("the minimize control stops being one of the existing section toggles",
     "class=\"section-toggle\" id=\"inspector-minimize\"",
     "class=\"dock-button\" id=\"inspector-minimize\"",
     "both controls ship, as the existing section toggle rather than as new kinds of control"),

    ("the expand control stops being one of the existing section toggles",
     "class=\"section-toggle\" id=\"inspector-expand\"",
     "class=\"dock-button\" id=\"inspector-expand\"",
     "both controls ship, as the existing section toggle rather than as new kinds of control"),

    # One label for both directions is the defect the single control had by construction; here it is
    # one control among two saying something the other control means.
    ("the minimize control names an action it does not perform",
     "aria-label=\"折叠到最小\" title=\"折叠到最小\"",
     "aria-label=\"切换检视\" title=\"切换检视\"",
     "each control ships a label naming what its first press does"),

    # A dangling aria-controls is invisible to every other rule here and to a reader of the diff.
    ("a control points at a container that does not exist",
     "aria-controls=\"panels\" aria-label=\"折叠到最小\"",
     "aria-controls=\"panel\" aria-label=\"折叠到最小\"",
     "both controls point at a container that exists"),

    # The attribute is what makes `.section-toggle` rotate its icon. On the expand button it is the
    # honest signal and the glyph opts out in CSS instead; on the minimize button there is no honest
    # signal to carry — the dash IS the glyph — so the attribute has no business being there.
    ("the minimize control gains the attribute that rotates its dash",
     "class=\"section-toggle\" id=\"inspector-minimize\" aria-controls=\"panels\"",
     "class=\"section-toggle\" id=\"inspector-minimize\" aria-expanded=\"false\" aria-controls=\"panels\"",
     "the minimize control carries no aria-expanded, which would rotate its dash"),

    # Containment, not presence. The ledger has its own `.panel-head` and it appears earlier in the
    # document, so the first version of this assertion — which looked the wrapper up in the whole
    # file — was satisfied by a head holding neither control. See §8.2 in the guard.
    ("the controls move out of the inspector's own head",
     "<div class=\"panel-head-actions\">",
     "<div class=\"panel-head-actions-outside\">",
     "both controls ship inside the inspector panel's own head"),

    # `.panel-head` is `flex-wrap: wrap`. Two loose children are two flex items and either can take
    # its own line; one inline-flex group with `flex: none` cannot.
    ("the two controls become two loose children of a header that wraps",
     "      .panel-head-actions {\n        display: inline-flex;\n",
     "      .panel-head-actions {\n",
     "the two controls are one flex group, so a wrapped header cannot split them across lines"),

    ("the inspector panel loses the class every other section uses",
     "<section class=\"panel\" id=\"inspector-panel\"",
     "<section class=\"aside\" id=\"inspector-panel\"",
     "the panel is a .panel, the same block every other section uses"),

    # ---- the three states ----

    ("the panel starts pinned instead of in the document",
     "        inspectorDock: 'flow',\n",
     "        inspectorDock: 'docked',\n",
     "the panel starts in the document, not pinned"),

    ("the exit that pins the panel names the wrong pinned state",
     "        setInspectorDock('docked');\n      }\n\n      function resetInspectorDock() {",
     "        setInspectorDock('full');\n      }\n\n      function resetInspectorDock() {",
     "the scroll exit that pins the panel hands its literal to that one writer"),

    # The early return is what keeps a scroll handler that fires on every frame from re-running the
    # whole repaint on every tick. Without it nothing looks wrong and the panel does the same work
    # sixty times a second.
    ("the exit that pins the panel stops guarding against a redundant call",
     "      function dockInspector() {\n        if (state.inspectorDock !== 'flow') return;\n",
     "      function dockInspector() {\n",
     "the scroll exit that pins the panel hands its literal to that one writer"),

    ("the exit that unpins stops putting the panel back in the document",
     "        setInspectorDock('flow');\n",
     "        setInspectorDock('docked');\n",
     "the scroll exit that unpins hands its literal to that one writer"),

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
    # on every screen at every width. It is the mutation that reproduces the reviewer's 「支持resize,没做」
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

    # D38 collapsed five writers into one. A fourth place to write the field is still how a
    # three-state field quietly grows a fourth state, so this one survives with a new name: inserted
    # into wire(), where nothing else writes the field, so it is a genuinely new writer.
    ("a fourth place writes the dock state",
     "      function wire() {\n",
     "      function wire() {\n        state.inspectorDock = 'docked';\n",
     "nothing writes the dock state except the one writer and the lost-selection exit"),

    # …and the shape D38 had to be careful not to introduce while removing the shape it was
    # removing: two controls, each assigning the field. R1 in one edit.
    ("one of the two controls writes the dock state instead of handing it to the writer",
     "          setInspectorDock(state.inspectorDock === 'folded' ? inspectorFoldReturnDock() : 'folded');\n",
     "          state.inspectorDock = state.inspectorDock === 'folded' ? inspectorFoldReturnDock() : 'folded';\n",
     "no control writes the dock state itself: both hand a target to the one writer"),

    # Looks like a harmless optimisation, and freezes the panel halfway through every drag: the drag
    # calls the writer with 'docked' on each pointermove, so the early return eats every one of them
    # after the first. Nothing else in the file changes and the panel still works until you resize.
    ("the writer skips a call that asks for the state it is already in",
     "        state.inspectorDock = next;\n        applyInspectorDock();\n",
     "        if (state.inspectorDock === next) return;\n"
     "        state.inspectorDock = next;\n        applyInspectorDock();\n",
     "the writer\'s whole body is the memory write plus the change, with no early return"),

    ("the writer changes the field and never repaints",
     "        state.inspectorDock = next;\n        applyInspectorDock();\n",
     "        state.inspectorDock = next;\n",
     "one function writes the dock state, for everything that reacts to input"),

    # A second repaint path through the same state change — the reason the writer is a function.
    ("a scroll exit repaints on its own instead of going through the writer",
     "        setInspectorDock('flow');\n",
     "        state.inspectorDock = 'flow';\n        applyInspectorDock();\n",
     "both scroll exits repaint through the writer, not on their own"),

    ("a drag writes the dock state instead of handing it to the writer",
     "        setInspectorDock('docked');\n        event.preventDefault();\n",
     "        state.inspectorDock = 'docked';\n        event.preventDefault();\n",
     "a drag settles the panel into the docked state rather than leaving it expanded"),

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

    # 'full' means the cap comes off, so a drag that leaves the panel there is a grip that does
    # nothing in the state where it is most visible. Re-anchored on D38's writer rather than deleted:
    # the rule is unchanged, the spelling of the line it breaks is not.
    ("a drag leaves the panel fully expanded",
     "        setInspectorDock('docked');\n        event.preventDefault();\n",
     "        setInspectorDock('full');\n        event.preventDefault();\n",
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
    # effect. The anchor moved when D34 added `&& !folded` to the same condition — re-anchored on
    # the new expression rather than deleted, because the guard it reports is still the one that has
    # to fail.
    ("the grip is offered even when the panel is not pinned",
     "        if (dom.inspectorResize) dom.inspectorResize.hidden = !(narrow && docked && !folded);\n",
     "        if (dom.inspectorResize) dom.inspectorResize.hidden = false;\n",
     "the grip is offered exactly where there is a height to drag"),

    # A drag that ends because the browser took the capture leaves the drag object alive, and every
    # later pointermove then resizes a panel nobody is touching.
    ("a cancelled drag is never released",
     "        dom.inspectorResize.addEventListener('pointercancel', onInspectorResizeUp);\n",
     "",
     "the grip listens for pointercancel"),

    # ---- the two contracts ----
    #
    # The two visibility rules differ by exactly one term, and the difference IS the design, so each
    # gets its own mutation in each direction: a rule that lost `|| docked` offers a control for a
    # panel in the document, and a rule that gained `|| folded` takes away the only way out of the
    # one state that has none.

    ("the minimize control stays on screen when the panel is not pinned",
     "        minimize.hidden = !narrow || !docked;\n",
     "        minimize.hidden = !narrow;\n",
     "the minimize control is offered wherever there is a height to change"),

    ("the expand control is offered on a panel that has nowhere to expand to",
     "        expand.hidden = !narrow || !docked || folded;\n",
     "        expand.hidden = !narrow || !docked;\n",
     "the expand control is offered on the two heights it toggles between"),

    # The difference between the two rules, and the only state with no other way out: this one turns
    # 「fold it away」 into 「dismiss it」, and the panel still renders, the selection is still there,
    # and every other rule in the guard still passes.
    ("folding takes the only way back with it",
     "        minimize.hidden = !narrow || !docked;\n",
     "        minimize.hidden = !narrow || !docked || folded;\n",
     "the minimize control is offered wherever there is a height to change"),

    ("the expand control stops reporting which of the two heights it is in",
     "        expand.setAttribute('aria-expanded', expanded ? 'true' : 'false');\n",
     "        expand.setAttribute('aria-expanded', 'true');\n",
     "the expand control reports which of the two heights it is in"),

    # Tooltip and accessible name from two separate ternaries: the tooltip keeps describing the
    # action the control stopped performing, and every presence check on the labels still passes.
    ("a control writes its tooltip from its own copy of the label",
     "        minimize.setAttribute('title', minLabel);\n",
     "        minimize.setAttribute('title', '折叠到最小');\n",
     "no control writes its tooltip from anything but its own label variable"),

    # The disclosure rotation is the correct idiom for a disclosure triangle and the wrong one here:
    # the expand button legitimately carries aria-expanded, so the rule matches it, and without the
    # opt-out the chevron points sideways in the state it spends most of its time in.
    ("the expand glyph is left to the disclosure rotation",
     "      #inspector-expand .icon {\n        transform: none;\n        transition: none;\n      }\n",
     "      #inspector-expand .icon {\n        transition: none;\n      }\n",
     "the expand control carries aria-expanded, and its glyph opts out of the disclosure rotation"),

    # The D27 shape again, one level down: the write sits inside `if (dom.inspectorExpandIcon)`, so
    # losing the lookup turns the whole branch into a silent no-op while every other rule stays green.
    ("the expand glyph is looked up under a name nothing writes",
     "        dom.inspectorExpandIcon = document.getElementById('inspector-expand-icon');\n",
     "",
     "the expand glyph is bound at lookup, and its direction comes from the same field"),

    ("the expand glyph stops pointing the way its click goes",
     "        if (dom.inspectorExpandIcon) {\n"
     "          dom.inspectorExpandIcon.setAttribute(\n"
     "            'd',\n"
     "            expanded ? 'M4 9.5 8 5.5 12 9.5' : 'M4 6.5 8 10.5 12 6.5'\n"
     "          );\n"
     "        }\n",
     "        if (dom.inspectorExpandIcon) {\n"
     "          dom.inspectorExpandIcon.setAttribute('d', 'M4 6.5 8 10.5 12 6.5');\n"
     "        }\n",
     "the expand glyph is bound at lookup, and its direction comes from the same field"),

    # Anchored on the whole path element, not on the `d` alone: three glyphs in the file share this
    # chevron, so a bare `d="…"` matched three times and the harness refused rather than guessing.
    ("the expand glyph ships pointing at nothing",
     "<path id=\"inspector-expand-icon\" d=\"M4 6.5 8 10.5 12 6.5\" />",
     "<path id=\"inspector-expand-icon\" d=\"\" />",
     "the expand glyph is bound at lookup, and its direction comes from the same field"),

    # D34 turned one label expression into a chain; D38 turned the chain into two, one per control.
    # Same defect — one label for every state — and now there are two copies of it to catch.
    ("the minimize label is written once for every state",
     "          ? (inspectorFoldReturnDock() === 'full' ? '恢复到完全展开' : '恢复到半高')\n"
     "          : '折叠到最小';\n",
     "        var minLabel = '折叠到最小';\n",
     "the minimize label is produced from the field, and both its outcomes are named"),

    ("the expand label is written once for every state",
     "        var expandLabel = expanded ? '收起为半高' : '完全展开检视';\n",
     "        var expandLabel = '完全展开检视';\n",
     "the expand label is produced from the field, and both its outcomes are named"),

    ("the expanded height stops being measured",
     CEILING_BODY,
     "          var panelMax = 480;",
     "the expanded height is measured from the window and the pinned offsets"),

    # ---- the ledger keeps its share of the window ----

    # The defect as shipped: the expanded panel ran the full height below the pinned strips and
    # not one ledger row was left on screen.
    ("the expanded panel covers the ledger again",
     "          var panelMax = Math.max(INSPECTOR_MIN_DOCK_H, inspectorUnderPins() - ledgerReserve);",
     "          var panelMax = Math.max(INSPECTOR_MIN_DOCK_H, inspectorUnderPins());",
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

    # The one that shows up as working code. `>=` is true both above and below the fold. D36 moved
    # the question from the panel to the band, and `>=` is still wrong there for the same reason:
    # `>= -1` is true for a band parked anywhere at the top AND for one just above it.

    ("the band test loosened to fit both sides of the fold",
     "var pinned = band.getBoundingClientRect().top <= 1;",
     "var pinned = band.getBoundingClientRect().top >= -1;",
     "pinned means the filter band is at the top of the viewport"),

    # The reference that was added to fix the one above, and made the panel never dock at all. Same
    # edit against the new subject: a second reference that is not the band is still a second
    # reference, and #overview is the strip directly above the columns, so it is tempting.
    ("a different strip is consulted as the second reference",
     "var band = dom.filterSticky;",
     "var band = dom.overview;",
     "the band it reads is the element the report names"),

    # Virtualised ledger: offsetTop is ~7,300px short, so this fires on scroll position. The D32
    # form of this mutation read the panel's offsetTop; the panel is no longer in the decision at
    # all, so the same mistake now has to be written the way it would actually be written — as the
    # band being asked for its position in the document as well as on screen.
    ("the decision reads a position in the document",
     "var pinned = band.getBoundingClientRect().top <= 1;",
     "var pinned = band.getBoundingClientRect().top <= 1 || dom.inspectorPanel.offsetTop < 1;",
     "the decision does not read the panel's position in the document"),

    # The panel's own bottom edge: the predicate D36 removed, and the one that made it wrong. It
    # still reads true, still looks like a position test, and pins the panel around scrollY 550 —
    # 140px before the band has reached the top.
    ("the decision falls back to the panel's own bottom edge",
     "var pinned = band.getBoundingClientRect().top <= 1;",
     "var pinned = Math.abs(dom.inspectorPanel.getBoundingClientRect().bottom - window.innerHeight) <= 1;",
     "pinned means the filter band is at the top of the viewport"),

    # The band is read across a layer boundary and written across none. One line here gives the
    # filter layer a second owner of its state, and every other assertion in this file still passes
    # because none of them look at what was done to the band.
    ("the dock decision writes a class onto the band",
     "        var band = dom.filterSticky;\n        if (!band) return;\n",
     "        var band = dom.filterSticky;\n        if (!band) return;\n"
     "        band.classList.toggle('is-inspector-pinned', true);\n",
     "the decision reads a rectangle and writes nothing to any object"),

    # The same conjunction aimed at a strip that is not the band. Kept separate from the one above
    # because it fires a different rule: that one is 「is it the band」, this one is 「is it the only
    # reference」, and a guard that had only the first would pass this.
    ("a second reference is consulted as well",
     "var pinned = band.getBoundingClientRect().top <= 1;",
     "var pinned = band.getBoundingClientRect().top <= 1\n"
     "          && dom.columns.getBoundingClientRect().bottom < window.innerHeight - 1;",
     "no second reference is consulted: the panel is a child of anything it would be compared to"),

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

    # ---- what one press of each control does ----
    #
    # D38's report was not that the cycle was wrong — it was complete and correct, and reaching 半高
    # from 完全展开 still took two clicks. So the mutations below are no longer about a cycle losing
    # a state; they are about each control's own pair losing its partner.

    # Each of these three keeps the handler's shape and changes only the destination, so the one
    # that fires is the reachability rule and not 「the control is wired at all」. Deleting the whole
    # line instead would trip a coarser assertion and report a catch for the wrong reason — which is
    # what happened to the first attempt at all three.
    ("the expand control no longer comes back down to half height",
     "state.inspectorDock === 'full' ? 'docked' : 'full'",
     "state.inspectorDock === 'full' ? 'full' : 'full'",
     "from fully expanded one press reaches either of the other two heights"),

    ("a control offers to put the panel back in the document",
     "state.inspectorDock === 'full' ? 'docked' : 'full'",
     "state.inspectorDock === 'full' ? 'flow' : 'full'",
     "no control can put the panel back in the document; the scroll decision owns that alone"),

    ("a control repaints the panel a second time on its own",
     "          setInspectorDock(state.inspectorDock === 'full' ? 'docked' : 'full');\n",
     "          setInspectorDock(state.inspectorDock === 'full' ? 'docked' : 'full');\n"
     "          applyInspectorDock();\n",
     "no control repaints on its own: the writer is the only place a change becomes visible"),

    # ---- D39: the way out of folded remembers where the reader came from ----
    #
    # 「恢复到半高」 shipped as a literal and was wrong for half the cases: fold a fully expanded panel
    # and it came back to half height. Every assertion about the label and the press stayed green
    # throughout, because both were present and both worked — they just did not agree about where the
    # reader was going. That is the shape these seven reproduce.

    ("the folded exit goes back to half height whatever came before it",
     "          setInspectorDock(state.inspectorDock === 'folded' ? inspectorFoldReturnDock() : 'folded');\n",
     "          setInspectorDock(state.inspectorDock === 'folded' ? 'docked' : 'folded');\n",
     "the way out of folded is decided by where the reader came from, not written at the control"),

    ("the folded exit ignores the height the reader came from",
     "      function inspectorFoldReturnDock() {\n"
     "        return state.inspectorDockBeforeFold === 'full' ? 'full' : 'docked';\n",
     "      function inspectorFoldReturnDock() {\n"
     "        return state.inspectorDockBeforeFold === 'full' ? 'docked' : 'docked';\n",
     "a full panel comes back full, and every other height comes back to half"),

    # The false branch, not the true one. `resolveDestination` can only follow the branch the memory
    # is currently set to, so a defect in the other branch is invisible to every reachability
    # assertion in the guard — which is why there is a rule over the tokens rather than over the
    # resolved value.
    ("the folded exit drops a half-height panel into a state that is not one",
     "        return state.inspectorDockBeforeFold === 'full' ? 'full' : 'docked';\n",
     "        return state.inspectorDockBeforeFold === 'full' ? 'full' : 'flow';\n",
     "the way out of folded can only name a pinned height, never a position"),

    # The label is the same rule read a second time. A label that picks its own branch is how the
    # button ends up saying 「恢复到半高」 and taking the reader to full height.
    ("the folded label picks its own branch instead of reading the rule",
     "          ? (inspectorFoldReturnDock() === 'full' ? '恢复到完全展开' : '恢复到半高')\n",
     "          ? '恢复到半高'\n",
     "the minimize label is produced from the field, and both its outcomes are named"),

    # A second reader of the memory is free to disagree with the function, and nothing else in the
    # file would see it: both spellings are individually correct.
    ("the memory gains a second reader that can disagree with the rule",
     "      function inspectorFoldReturnDock() {\n"
     "        return state.inspectorDockBeforeFold === 'full' ? 'full' : 'docked';\n",
     "      function inspectorFoldReturnDock() {\n"
     "        return state.inspectorDockBeforeFold === 'full' ? 'full' : 'docked';\n"
     "      }\n\n"
     "      function inspectorFoldReturnDockUnused() {\n"
     "        return state.inspectorDockBeforeFold === 'full' ? 'docked' : 'full';\n",
     "the remembered height is read in exactly one place"),

    ("the memory is written outside the one writer of the dock state",
     "      function dockInspector() {\n        if (state.inspectorDock !== 'flow') return;\n",
     "      function dockInspector() {\n        state.inspectorDockBeforeFold = 'full';\n"
     "        if (state.inspectorDock !== 'flow') return;\n",
     "one place remembers the height, and it is the writer of the dock state"),

    # Position is a promise like any other: both controls still ship, still are wired, still are
    # labelled correctly, and the one that folds the panel is now on the left.
    ("the control that folds the panel moves back to the left",
     "          <div class=\"panel-head-actions\">\n"
     "            <button type=\"button\" class=\"section-toggle\" id=\"inspector-expand\"",
     "          <div class=\"panel-head-actions\">\n"
     "            <button type=\"button\" class=\"section-toggle\" id=\"inspector-minimize\"\n"
     "              aria-controls=\"panels\" aria-label=\"折叠到最小\" title=\"折叠到最小\" hidden></button>\n"
     "            <button type=\"button\" class=\"section-toggle\" id=\"inspector-expand\"",
     "the control that folds the panel is the rightmost of the two"),

    ("the minimize glyph stops following its label and stays a dash",
     "            folded ? 'M3.5 8.5 h5.5 v5 h-5.5 z M6.5 8.5 v-5 h6 v5 h-2.5' : 'M3.5 8 H12.5'\n",
     "            'M3.5 8 H12.5'\n",
     "the minimize glyph follows its label: a dash to fold away, a restore mark to come back"),

    # ---- D40: the same layer, a different region above the breakpoint ----
    #
    # The narrow-side assertions cannot see any of this: they are scoped to `(max-width: 1080px)` and
    # read as if the panel had no wide behaviour at all, which until D40 it did not.

    # The defect as shipped, in one edit. Without the sticky the panel is a static block at the top of
    # a 7,545px grid row: measured, it showed 692px at scrollY=0 and 0 from scrollY 1645 onward, so it
    # was invisible across 88% of the trajectory.
    ("the wide panel stops being pinned and scrolls away again",
     "      @media (min-width: 1081px) {\n        #inspector-panel {\n          position: sticky;\n",
     "      @media (min-width: 1081px) {\n        #inspector-panel {\n          position: static;\n",
     "the wide panel sticks under the two measured strips"),

    # Both offsets matter and neither is decorative: without the band the panel rides over the filter
    # row, without the overview it disappears under it.
    ("the wide panel pins to the wrong place under the strips",
     "          top: calc(var(--sticky-band-h, 32px) + var(--sticky-overview-h, 51px));\n",
     "          top: var(--sticky-band-h, 32px);\n",
     "the wide panel sticks under the two measured strips"),

    # The 「harmless addition」: the window bar only ever occupies the LEFT column, so adding it to
    # the sum drops the panel 45px for no reason — and nothing else in the guard would notice.
    ("the wide top starts including the window bar, which is never on this side",
     "          top: calc(var(--sticky-band-h, 32px) + var(--sticky-overview-h, 51px));\n",
     "          top: calc(var(--sticky-band-h, 32px) + var(--sticky-overview-h, 51px) + var(--sticky-window-h, 45px));\n",
     "the wide top excludes the window bar, which only ever occupies the left column"),

    # A re-measurement instead of a read: band and overview are L2's and L3's facts, and a fifth
    # place holding them is exactly what verify-generation-pin's 23 assertions exist to prevent.
    ("the wide top measures the strips again instead of reading them",
     "          top: calc(var(--sticky-band-h, 32px) + var(--sticky-overview-h, 51px));\n",
     "          top: 135px;\n",
     "the wide panel sticks under the two measured strips"),

    # The narrow scheme leaking across. `bottom: 0` is a promise about a panel shorter than the
    # scrollport, and on a wide screen the panel is its own column beside a very tall ledger.
    ("the narrow scheme leaks into the wide region",
     "      @media (min-width: 1081px) {\n        #inspector-panel {\n          position: sticky;\n",
     "      @media (min-width: 1081px) {\n        #inspector-panel {\n          position: sticky;\n          bottom: 0;\n",
     "the wide panel is not pinned to the bottom of anything"),

    # The ceiling and its scroller are one rule. Drop the ceiling and the panel grows past the fold
    # again — the same invisible defect by a different door — and drop the scroller and what is left
    # of it is a truncated panel with no way to reach the rest.
    ("the wide panel loses its ceiling and grows out of the viewport again",
     "          max-height: var(--inspector-wide-h, 70vh);\n",
     "",
     "the wide panel is capped, and scrolls its own content"),

    ("the wide panel is capped but cannot scroll, so the rest of the record is unreachable",
     "          max-height: var(--inspector-wide-h, 70vh);\n          overflow-y: auto;\n",
     "          max-height: var(--inspector-wide-h, 70vh);\n",
     "the wide panel is capped, and scrolls its own content"),

    # `vh` here would be the reader's window on no host at all — this page runs in an iframe. The
    # assertion is on the expression because a token check is satisfied by reading band and overview
    # while computing the ceiling from neither.
    ("the wide ceiling is computed from the strips instead of the window",
     "            inspectorUnderPins() - INSPECTOR_WIDE_BOTTOM_GAP\n",
     "            Math.round(band + overview + INSPECTOR_WIDE_BOTTOM_GAP)\n",
     "the wide ceiling is measured from the window, and never from vh"),

    ("the wide ceiling goes back to vh",
     "            inspectorUnderPins() - INSPECTOR_WIDE_BOTTOM_GAP\n",
     "            Math.round(window.innerHeight * 0.7)\n",
     "the wide ceiling is measured from the window, and never from vh"),

    ("a second place computes the wide ceiling",
     "      function syncStickyOffsets() {\n",
     "      function syncInspectorWideHeight() {\n"
     "        document.documentElement.style.setProperty('--inspector-wide-h', '620px');\n"
     "      }\n\n"
     "      function syncStickyOffsets() {\n",
     "the wide ceiling has exactly one writer, and it is the function that already owns the strips"),

    ("the hair of viewport below the wide panel becomes a literal",
     "inspectorUnderPins() - INSPECTOR_WIDE_BOTTOM_GAP",
     "inspectorUnderPins() - 12",
     "the hair of viewport below the wide panel is a named number, not a literal in the arithmetic"),

    # A wide block that reached outside `#inspector-panel` would move something the report never
    # mentioned, and no other assertion in this file would see it.
    ("the wide region starts moving the filter band as well",
     "      @media (min-width: 1081px) {\n        #inspector-panel {\n",
     "      @media (min-width: 1081px) {\n        #filter-sticky {\n"
     "          max-height: var(--inspector-wide-h, 70vh);\n        }\n\n        #inspector-panel {\n",
     "the wide region touches the panel and nothing else"),

    ("the expand control can fold the panel away, so folded has two doors",
     "state.inspectorDock === 'full' ? 'docked' : 'full'",
     "state.inspectorDock === 'full' ? 'docked' : 'folded'",
     "the minimize control is the only way into folded and the only way out of it"),

    # The field moves and the panel is repainted twice: one call through the writer and one beside
    # it. Reads as harmless, and it is a second path from a change to a repaint.
    ("a control repaints the panel a second time on its own",
     "          setInspectorDock(state.inspectorDock === 'full' ? 'docked' : 'full');\n",
     "          setInspectorDock(state.inspectorDock === 'full' ? 'docked' : 'full');\n"
     "          applyInspectorDock();\n",
     "no control repaints on its own: the writer is the only place a change becomes visible"),

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

    # ---- the third height, and the one that was missing ----
    #
    # `flow` is a position, not a height, so a field with three values had only two the reader could
    # pick. Each of these leaves the panel rendering, the selection intact and every other guard
    # green.

    ("folding takes the header away with the content",
     "        #inspector-panel.is-inspector-folded > *:not(.panel-head) {\n          display: none;",
     "        #inspector-panel.is-inspector-folded > * {\n          display: none;",
     "folded keeps the header and takes the rest out of flow"),

    ("the panel can be folded away but never unfolded",
     "        return state.inspectorDockBeforeFold === 'full' ? 'full' : 'docked';\n",
     "        return state.inspectorDockBeforeFold === 'full' ? 'folded' : 'docked';\n",
     "from folded one press lands on a pinned height rather than on nothing"),

    # The version this section shipped first: a cap written down as a number, which then had to be
    # measured correctly and was not — it came out 2px short and clipped the header it was capping.
    ("the folded height is a number written into the stylesheet",
     "        #inspector-panel.is-inspector-folded > *:not(.panel-head) {\n          display: none;",
     "        #inspector-panel.is-inspector-folded > *:not(.panel-head) {\n          display: none;\n          max-height: 51px;",
     "folded is the header alone, so its height needs no number of its own"),

    # ---- the header, and the control that lives in it ----
    #
    # The file already lost a round to this shape once: `.panel { overflow: hidden }` turned every
    # sticky descendant into a child pinned inside a box that never scrolls. This is the mirror of
    # it — a panel that scrolls, and a header that is not sticky, so the handle scrolls out of reach.

    ("the panel header scrolls away with the content again",
     HEAD_RULE,
     HEAD_RULE.replace("position: sticky;", "position: static;"),
     "the panel header stays at the top while its content scrolls under it, at every width"),

    ("the sticky header handed to every panel on the page",
     HEAD_RULE,
     HEAD_RULE + BARE_HEAD,
     "the sticky header is declared once, at the top level, for the inspector panel alone"),

    # ---- D41: the scope a correct rule was written for stopped being true ----

    # D40 gave the wide panel a ceiling and an inner scroller, so the sentence that scoped this
    # header to the dock query — above 1080px the panel is not a scroll container and there is
    # nothing to stick to — stopped being true, and the narrow-only scoping went with it.
    ("the sticky header pinned one band down instead of to the edge",
     HEAD_RULE,
     HEAD_RULE.replace("top: 0;", "top: 4px;"),
     "the panel header stays at the top while its content scrolls under it, at every width"),

    # A second copy, back inside the dock query: still sticky, still one declaration per property,
    # still correct-looking in review — and unreachable above the breakpoint, which IS the defect.
    ("the sticky header declared a second time inside the dock query",
     DOCK_RULE,
     DOCK_RULE + DOCK_HEAD_COPY,
     "the sticky header is declared once, at the top level, for the inspector panel alone"),

    # The premise, not the rule: a panel that is not a scroll container anywhere is what makes an
    # unscoped sticky head unsafe.
    ("the wide panel losing its own scroller",
     WIDE_OVERFLOW,
     WIDE_OVERFLOW.replace("overflow-y: auto;", "overflow-y: visible;"),
     "every width gives the panel its own scroller, which is what makes an unscoped sticky head safe"),

    # ---- D42: two derivations of one fact, and a write nobody reads ----

    # The narrow ceiling goes back to doing its own arithmetic. The helper is still there and
    # still used by the wide side, so every pre-existing assertion stays green; what changes is
    # that the two halves can now drift apart without a single guard noticing.
    ("the narrow ceiling stops borrowing the shared sum",
     CEILING_BODY,
     CEILING_REDERIVED,
     "both ceilings subtract their reserve from one shared sum, not from their own copy of it"),

    # The narrow writer stops looking at the layout. The numbers it writes are then correct in
    # the layout that reads them and authoritative-looking in the one that does not — which is
    # how --inspector-full-h came to sit at 540px on a screen whose panel was capped at 753px.
    ("the narrow ceiling is written on a wide screen too, where nothing reads it",
     NARROW_WRITER,
     '        if (dom.inspectorPanel) {',
     'each ceiling is written only in the layout whose rules read it'),

    # The mirror: the wide ceiling gets written at every width, including the one whose rules
    # live inside the dock query and never mention it.
    ("the wide ceiling is written on a narrow screen too, where nothing reads it",
     WIDE_WRITER,
     '        if (true) {',
     'each ceiling is written only in the layout whose rules read it'),

    # A second reader of the strips is the shape this had before D42: two functions each pulling
    # the same two numbers out of the document element for their own ceiling.
    ("a second place reads the measured strips for its own ceiling",
     UNDERPINS_BODY,
     UNDERPINS_BODY + SECOND_READER,
     'one place reads the measured strips when it needs a ceiling'),
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