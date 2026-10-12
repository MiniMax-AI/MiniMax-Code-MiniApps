"""Move the 上下文代 picker out of the sticky band and require verify-generation-pin.mjs to report
each way back by name.

The defect this guards is not a wrong number: it is that nothing was wrong until a reader scrolled.
The picker shipped in #toolbar, the one block above the band that does scroll away, so from anywhere
in the ledger the control that says which slice of the conversation is on screen was not on screen.
No other guard asserted where it lived, which is why a change of that kind costs nothing to make.

Each mutation below is one way that move can come back wearing a different hat: the control goes
back to the toolbar, or into the kind toolbar whose label promises type filtering, or gains the
attribute that lets a rule dim it, or takes back the toolbar's 36px height, or the row it shares
stops being allowed to wrap. See docs/LAYERS.md.

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
    '        <div class="filter-row-tail">\n'
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
