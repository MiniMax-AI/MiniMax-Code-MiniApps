"""Move the 上下文代 picker out of the sticky band and require verify-generation-pin.mjs to report
each way back by name.

The defect this guards is not a wrong number: it is that nothing was wrong until a reader scrolled.
The picker shipped in #toolbar, the one block above the band that does scroll away, so from anywhere
in the ledger the control that says which slice of the conversation is on screen was not on screen.
No other guard asserted where it lived, which is why a change of that kind costs nothing to make.

Each mutation below is one way that move can come back wearing a different hat: the control goes
back to the toolbar, or into the kind toolbar whose label promises type filtering, or gains the
attribute that lets a rule dim it, or takes back the toolbar's 36px height, or the row it shares
stops being allowed to wrap. The last three are the other direction — D19 hid the picker from a
`body.is-reading-down` class driven by scroll direction, was withdrawn on 2026-10-12, and these
require the guard to catch each shape of its return. See docs/LAYERS.md.

Anchors are multi-line and index.html is LF, so they are written with bare \\n and the file is read
and written with newline='' — matching on normalised text while preserving the file's own endings.
"""
import io
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CLIENT = os.path.join(os.path.dirname(HERE), "miniapp", "client", "index.html")
PROBE = os.path.join(HERE, "verify-generation-pin.mjs")

# The block as it ships, used by several mutations below. Kept as one string so a move and a delete
# cannot drift apart: two hand-copied copies of the same markup is how a mutation ends up testing a
# shape the file no longer has.
TAIL = (
    '        <div class="filter-row-tail" id="filter-row-tail">\n'
    '          <div class="field" id="generation-field" hidden>\n'
    '            <label class="field-label sr-only" for="generation-select">上下文代</label>\n'
    '            <select id="generation-select" aria-describedby="generation-hint"></select>\n'
    '          </div>\n'
    '        </div>\n'
)

TOOLBAR_ANCHOR = '          <div class="field field-grow" data-filter-scope>\n'

MUTATIONS = [
    # The defect verbatim: the control is on the page and works, and is somewhere the reader is not.
    ("the picker goes back to the toolbar that scrolls away",
     [(TAIL, ""),
      (TOOLBAR_ANCHOR,
       '          <div class="field" id="generation-field" hidden>\n'
       '            <label class="field-label" for="generation-select">上下文代</label>\n'
       '            <select id="generation-select" aria-describedby="generation-hint"></select>\n'
       '          </div>\n'
       '          <div class="field field-grow" data-filter-scope>\n')],
     "the 上下文代 picker ships inside the sticky band, not in the toolbar that scrolls away"),

    # Pinned is not the same as filed under the type filter. #kind-controls is role="toolbar"
    # aria-label="按类型筛选轨迹": a generation picker inside it makes that label announce a promise
    # the control does not keep, and a screen reader lands on it inside the type-filter group.
    ("the picker is filed inside the kind toolbar",
     [(TAIL, ""),
      ('        <nav class="traj-controls-actions" aria-label="按类型筛选轨迹">\n',
       '        <nav class="traj-controls-actions" aria-label="按类型筛选轨迹">\n'
       '          <div class="field" id="generation-field" hidden>\n'
       '            <label class="sr-only" for="generation-select">上下文代</label>\n'
       '            <select id="generation-select" aria-describedby="generation-hint"></select>\n'
       '          </div>\n')],
     "the picker is not inside the kind toolbar, whose label promises type filtering"),

    # The one that looks most like tidiness. data-filter-scope is what applyFilterScope() reads to
    # dim and disable the controls that cannot change what is on screen while a 异常 rule is on —
    # and generation is exactly the control a reader reaches for while reading a list of failures.
    ("the picker is marked, so a rule on screen can disable it",
     [('          <div class="field" id="generation-field" hidden>\n',
       '          <div class="field" id="generation-field" data-filter-scope hidden>\n')],
     "the picker carries no data-filter-scope, so a rule on screen cannot disable it"),

    # The banner is the picker's aria-describedby target and it only exists while a generation is
    # pinned. Left in the ledger panel it scrolls away while the control that caused it stays
    # pinned, and a reader deep in a frozen snapshot loses the sentence that says so.
    ("the banner goes back to the ledger panel, away from the picker",
     [('        <p class="generation-note" id="generation-hint" hidden></p>\n', ""),
      ('          <div class="window-bar" id="window-bar" aria-label="列表视图控制"></div>\n',
       '          <p class="generation-note" id="generation-hint" hidden></p>\n'
       '          <div class="window-bar" id="window-bar" aria-label="列表视图控制"></div>\n')],
     "the banner ships inside the same band as the picker it describes"),

    # 176px is what the type row leaves at 845px and the picker itself measures 158px. A visible
    # label spends 56 of those on saying the word the select already says in its first option.
    ("the label stops being screen-reader-only and spends the row's width",
     [('            <label class="field-label sr-only" for="generation-select">上下文代</label>\n',
       '            <label class="field-label" for="generation-select">上下文代</label>\n')],
     "that label is sr-only: 176px is what the type row leaves and the label would spend 56 of them"),

    # .traj-controls is `flex: none`. Without flex-wrap a tail that does not fit widens the row past
    # the page instead of stepping down to a line of its own, and the band stops being a band.
    ("the row stops being allowed to wrap",
     [('      .filter-row {\n        display: flex;\n        flex-wrap: wrap;\n',
       '      .filter-row {\n        display: flex;\n')],
     "the band row wraps, so a picker that does not fit steps down instead of widening the page"),

    # `.field { flex: 1 1 100% }` under max-width: 767px was written for toolbar fields that each
    # get a whole line. In a `flex: none` tail it sizes the field against the tail instead, which is
    # the sideways growth the wrap above exists to prevent.
    ("the toolbar's narrow-screen field rule is left to govern the band",
     [('        .filter-row-tail .field {\n          flex: none;\n        }\n\n', '')],
     "the toolbar field rule is overridden for the picker, so 100% cannot size it against the tail"),

    # The same pair, on the select: `select { width: 100% }` at narrow widths overrides the band's
    # own sizing and the picker fills whatever the tail happens to measure.
    ("the toolbar's narrow-screen select rule is left to govern the band",
     [('        .filter-row-tail select {\n          width: auto;\n          max-width: min(320px, 70vw);\n        }\n', '')],
     "the toolbar select rule is overridden for the picker"),

    # The band's height is reading area the reader does not get: it is pinned over the ledger. Every
    # other control in it is a 20px chip; the toolbar's select is 36px, so this costs 16px on every
    # page for the privilege of reusing a rule written for a different layer.
    ("the picker goes back to the toolbar's 36px and grows the band",
     [('      .filter-row-tail select {\n        min-height: 20px;\n', '      .filter-row-tail select {\n')],
     "the picker is as tall as the chips beside it, not the toolbar 36px"),

    # The tail takes its left padding back and the picker drops to its own line
    ("the tail takes its left padding back and the picker drops to its own line",
     [('        padding: 6px 16px 6px 0;\n', '        padding: 6px 16px;\n')],
     "the tail is pushed right by margin-left, so it carries no left padding to find width with"),

    # The one that actually happened while writing this: an edit that changed the padding dropped
    # margin-left on the way past, and the picker still landed on the right — 642px is both where
    # the column-gap puts it and where auto would have put it, because the numbers happen to agree
    # today. Nothing looked wrong and the row would have drifted the first time a kind chip changed
    # width. It was the assertion about the left padding that caught it, not the screenshot.
    ("the tail is no longer pushed to the right, and only looks right by coincidence",
     [('        margin-left: auto;\n        padding: 6px 16px 6px 0;\n',
       '        padding: 6px 16px 6px 0;\n')],
     "the tail is pushed right by margin-left, so it carries no left padding to find width with"),

    # The width of a <select> is the width of the widest option the browser has to draw. Writing a
    # number here encodes one machine's answer and truncates on any other — which is how
    # 「第 27 代（566 条）」 lost its last characters on this page once already.
    ("the picker is given a fixed width",
     [('      .filter-row-tail select {\n        min-height: 20px;\n',
       '      .filter-row-tail select {\n        min-height: 20px;\n        width: 158px;\n')],
     "no rule gives the picker a fixed width — the browser knows how wide its widest option is"),

    # ---- the withdrawal, in the three shapes it can come back in (D19, 2026-10-12) ----
    #
    # chli reported 「只要滚动就不见」. The picker was being hidden by `body.is-reading-down`, a
    # class on <body> toggled by a scroll listener from the direction of travel. Putting the control
    # in the band was right and this undid the benefit of it, so all three mutations below put it
    # back rather than only the one that was there before.

    # The rule itself. Note this is the same shape the withdrawal note in the stylesheet *describes*
    # in prose — which is exactly why the guard strips comments before scanning.
    ("the band is driven from <body> again",
     [('      .filter-row-tail select {\n        min-height: 20px;\n',
       '      body.is-reading-down .filter-row-tail {\n        opacity: 0;\n'
       '        visibility: hidden;\n      }\n\n'
       '      .filter-row-tail select {\n        min-height: 20px;\n')],
     "nothing inside the band is shown or hidden by a state class on <body>"),

    # The other half of the mechanism: with no reader of scroll direction there is nothing left to
    # drive such a class, and the page is back to having no scroll listener at all (D12, D15).
    ("a scroll listener comes back to decide what the band shows",
     [("        window.addEventListener('resize', scheduleStickyOffsets);\n",
       "        window.addEventListener('resize', scheduleStickyOffsets);\n"
       "        window.addEventListener('scroll', scheduleReadingDown, { passive: true });\n")],
     # The rule this mutation was written against said "no scroll listener at all". That wording
     # is gone: the inspector docks on a narrow screen and needs one. What the mutation actually
     # does is register a *dangling* handler — the withdrawal deleted the function and left the
     # call site behind — so the rule that catches it is the one that names it.
     "every scroll listener names a handler that exists, so a withdrawal cannot leave one dangling"),

    # The same defect without the ceremony: a rule on the tail itself.
    ("the picker is made invisible by a rule of its own",
     [('        margin-left: auto;\n        padding: 6px 16px 6px 0;\n',
       '        margin-left: auto;\n        padding: 6px 16px 6px 0;\n        visibility: hidden;\n')],
     "the band shows the picker by default — no rule of its own dims or hides it"),

    # ---- the band's other half: the type chips never wrapped (2026-10-12) ----
    #
    # .filter-row wrapped, and the stylesheet said so in prose: 「no clipping, no
    # sideways overflow」. That was true of the row and false of the page. The row
    # could step the picker down, but .traj-controls is `flex: none`, so it had no
    # way to step down anything that was itself wider than the viewport — and the
    # inner button row was 574px flat from a 360px viewport up. Measured: the
    # document was 622px wide at every viewport below 640, so the window scrolled
    # sideways by 22–262px. Both mutations are required: deleting the declaration
    # is how the defect arrived, and writing the opposite one is how it comes back
    # looking deliberate.

    ("the type chips stop wrapping",
     [('      .traj-controls-actions {\n'
       '        display: flex;\n'
       '        flex: 0 1 auto;\n'
       '        min-width: 0;\n'
       '        flex-wrap: wrap;\n',
       '      .traj-controls-actions {\n'
       '        display: flex;\n'
       '        flex: 0 1 auto;\n'
       '        min-width: 0;\n')],
     "the type chips wrap too, so ten buttons cannot widen the page at a narrow width"),

    ("the type chips are told not to wrap",
     [('      .traj-controls-actions {\n'
       '        display: flex;\n'
       '        flex: 0 1 auto;\n'
       '        min-width: 0;\n'
       '        flex-wrap: wrap;\n'
       '        align-items: center;\n',
       '      .traj-controls-actions {\n'
       '        display: flex;\n'
       '        flex: 0 1 auto;\n'
       '        min-width: 0;\n'
       '        flex-wrap: nowrap;\n'
       '        align-items: center;\n')],
     "the type chips wrap too, so ten buttons cannot widen the page at a narrow width"),

    # Wrap with nothing to wrap into. This is the mutation that matters most of
    # the three: it ships a declaration that reads like a working fix, satisfies
    # a wrap assertion, and measures identical to no change at all — because a
    # shrink-to-fit row is as wide as its widest line and never wraps.
    ("the type row loses the cap that gives the wrap something to wrap into",
     [('        max-width: 100%;\n'
       '        align-items: center;\n'
       '        padding: 6px 16px;\n'
       '        background: var(--mcode-bg);\n'
       '      }\n',
       '        align-items: center;\n'
       '        padding: 6px 16px;\n'
       '        background: var(--mcode-bg);\n'
       '      }\n')],
     "the type row is capped at the viewport, which is the only thing that wrap has to wrap into"),

    # And wrap with a row that refuses to shrink, which is the same trap wearing
    # the other hat: the wrap is present and the cap is present, and the content's
    # minimum size still wins.
    ("the chip row goes back to refusing to shrink",
     [('        flex: 0 1 auto;\n        min-width: 0;\n        flex-wrap: wrap;\n',
       '        flex: none;\n        min-width: 0;\n        flex-wrap: wrap;\n')],
     "the chip row is the part allowed to give way, because a row that cannot shrink cannot wrap"),

    # min-width defaults to `auto` on a flex item, which is the content's minimum
    # size — so dropping it restores the same overflow with the shrink still set.
    ("the chip row lets its content set the minimum width again",
     [('        min-width: 0;\n        flex-wrap: wrap;\n',
       '        flex-wrap: wrap;\n')],
     "the chip row is the part allowed to give way, because a row that cannot shrink cannot wrap"),
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
    for old, new in edits:
        hits = original.count(old)
        if hits != 1:
            raise SystemExit("FAIL  anchor for %r matched %d times" % (title, hits))
        if old == new:
            raise SystemExit("FAIL  empty mutation for %r: the anchor equals its replacement" % title)
    try:
        mutated = original
        for old, new in edits:
            mutated = mutated.replace(old, new, 1)
        if mutated == original:
            raise SystemExit("FAIL  mutation for %r changed nothing" % title)
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
