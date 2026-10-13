"""Mutation control for the ledger's two-ends control.

A guard that cannot fail is not a guard. Each mutation below breaks one of the rules in
verify-ledger-jump.mjs the way it would actually break in the file, and requires that guard to fail
with the right reason before the file is restored byte for byte.

Three of these break a bug that had already shipped once, so they are worth naming:

  * the flat `bottom: 12px` — a 35px overlap at 12 of 18 scroll positions on a real 22,527-message
    session, which the one position anybody spot-checked happened to be free of;
  * `window.scrollTo(0, 0)` for 「最上」 — the control claimed to go up and landed on the only screen
    in the app with no records on it;
  * `r.height > 0 || r.top < viewH` — the left term is true at every scroll position against a
    one-pixel sentinel, so the arrow pointed up everywhere. That one is a trivially-true term
    inside an `||`, which is the same defect as a tautology in an assertion: it looks like a test
    and measures nothing.

One breaks the rule this control's own reason for existing, which is why the offset writer is
asserted to have exactly one owner. A second writer of `--inspector-bottom-reserve` is a number
written twice from two places that each believe they own it, which is the shape every two-writer
defect in this client has taken.
"""
import io
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CLIENT = os.path.join(ROOT, "miniapp", "client", "index.html")
PROBE = os.path.join(HERE, "verify-ledger-jump.mjs")

MUTATIONS = [
    # ---------- the markup ----------

    ("the button ships with words in it",
     [('<button type="button" class="ledger-jump" id="ledger-jump" hidden aria-label="\u8df3\u5230\u8f68\u8ff9\u7684\u6700\u4f4e"></button>',
       '<button type="button" class="ledger-jump" id="ledger-jump" hidden aria-label="\u8df3\u5230\u8f68\u8ff9\u7684\u6700\u4f4e">\u5230\u6700\u4f4e</button>')],
     "the jump button ships with no text in it"),

    ("the button ships visible, before it has anything to show",
     [('id="ledger-jump" hidden aria-label=', 'id="ledger-jump" aria-label=')],
     "the jump button ships hidden, so there is no empty circle on first paint"),

    ("the button is not typed as a button",
     [('<button type="button" class="ledger-jump"', '<button class="ledger-jump"')],
     "the jump button is a button and not a link, so Enter and Space both work"),

    ("the button announces nothing",
     [(' hidden aria-label="\u8df3\u5230\u8f68\u8ff9\u7684\u6700\u4f4e"', ' hidden')],
     "the jump button carries a label of its own for anyone not looking at it"),

    # The sentinel lives outside #ledger on purpose: that element is cleared and rebuilt on every
    # poll, so an observer on something inside it would have to be rebuilt with the table.
    ("the sentinel is moved inside #ledger",
     [('\n          <div class="ledger-end" id="ledger-end" aria-hidden="true"></div>', ''),
      ('<div class="ledger-body" id="ledger"></div>',
       '<div class="ledger-body" id="ledger"><div class="ledger-end" id="ledger-end" aria-hidden="true"></div></div>')],
     "the sentinel is outside #ledger, which is cleared and rebuilt on every poll"),

    # The button first and the mark after it: the mark is what says where the panel's bottom
    # edge is, and a control that comes before it would be positioned against a mark nobody has
    # read yet.
    ("the button is put above the sentinel",
     [('          <div class="ledger-end" id="ledger-end" aria-hidden="true"></div>\n', ''),
      ('<button type="button" class="ledger-jump" id="ledger-jump" hidden aria-label="\u8df3\u5230\u8f68\u8ff9\u7684\u6700\u4f4e"></button>',
       '<button type="button" class="ledger-jump" id="ledger-jump" hidden aria-label="\u8df3\u5230\u8f68\u8ff9\u7684\u6700\u4f4e"></button>\n          <div class="ledger-end" id="ledger-end" aria-hidden="true"></div>')],
     "the sentinel and the button ship together, sentinel first"),

    ("the sentinel is announced to a reader",
     [('id="ledger-end" aria-hidden="true"', 'id="ledger-end"')],
     "the sentinel is inert to a reader, since it is a measuring mark and not content"),

    # ---------- the two arrows ----------

    ("one direction has no icon",
     [("\n        arrowUp: ['M8 13.2V2.8', 'M4.6 6.4 8 3l3.4 3.4']", "")],
     "both directions ship as icons"),

    ("an arrow loses its head",
     [("arrowDown: ['M8 2.8v10.4', 'M4.6 9.6 8 13l3.4-3.4']", "arrowDown: ['M8 2.8v10.4']")],
     "each arrow is a shaft and a head, not a single stroke"),

    # The names differ while the pictures are the same: the code reads correctly and the control
    # does nothing a reader could tell apart.
    ("the two arrows are the same picture under two names",
     [("arrowUp: ['M8 13.2V2.8', 'M4.6 6.4 8 3l3.4 3.4']", "arrowUp: ['M8 2.8v10.4', 'M4.6 9.6 8 13l3.4-3.4']")],
     "the two arrows are different shapes"),

    # ---------- what the control shows ----------

    ("the control goes back to words",
     [("          var glyph = icon(name);\n", "          var glyph = document.createTextNode(atEnd ? '\u5230\u6700\u4e0a' : '\u5230\u6700\u4f4e');\n")],
     "the control shows an arrow rather than a word"),

    # Re-anchored 2026-10-14 (D46). The arrow no longer reads `ledgerEndInView()` directly: the two
    # states now differ by the `ledgerJumpUsed` flag, so both the glyph and the click go through
    # `ledgerJumpGoesUp()`. The job is unchanged — the arrow still follows a reading rather than a
    # constant — so the mutation is the same one pointed at the line that now carries it.
    ("the arrow stops following the reading",
     [("var name = up ? 'arrowUp' : 'arrowDown';", "var name = 'arrowDown';")],
     "the reading that picks the arrow exists and is the one the label reads"),

    # ---- D46: the first screen points down whatever the page is at ----

    # The flag starts armed, so the first screen reports position and the control is back to
    # 「go to where you already are」 — the failure the arrow's own comment says it must never be.
    ("the reading starts armed instead of on the first press",
     [("var ledgerJumpUsed = false;", "var ledgerJumpUsed = true;")],
     "the reading starts unarmed, so the first screen points down whatever the page is at"),

    # The flag is never armed, so 「在底部」 never gets a vote and the control can only ever go
    # down. Reads like a working button: it scrolls, it relabels, it just never comes back up.
    ("the first press never arms the reading",
     [("          ledgerJumpUsed = true;\n", "")],
     "the first press arms the reading, and only the press does"),

    # The two lines in the wrong order. This is the original bug re-created from the inside: arm
    # first, then ask, so the first press consults a position the reader never chose.
    ("the reading is armed before the destination is chosen",
     [("          var up = ledgerJumpGoesUp();\n"
       "          window.scrollTo(0, up ? ledgerTopOffset() : ledgerBottomOffset());\n"
       "          // Armed after the scroll is issued, and the label is rewritten here rather than left to\n"
       "          // the observer: scrolling to the end you are already at fires no intersection event, and\n"
       "          // that is exactly the case where the arrow has to change.\n"
       "          ledgerJumpUsed = true;\n",
       "          ledgerJumpUsed = true;\n"
       "          var up = ledgerJumpGoesUp();\n"
       "          window.scrollTo(0, up ? ledgerTopOffset() : ledgerBottomOffset());\n")],
     "the destination is chosen before the reading is armed"),

    # The glyph and the scroll each read the reading themselves. They agree today because they are
    # the same call — and that is exactly why letting them drift is the one thing not to allow, now
    # that a flag is the only thing between the two states.
    ("the click stops reading what the arrow reads",
     [("          var up = ledgerJumpGoesUp();\n"
       "          window.scrollTo(0, up ? ledgerTopOffset() : ledgerBottomOffset());",
       "          window.scrollTo(0, up ? ledgerTopOffset() : ledgerBottomOffset());")],
     "the click chooses between the two ends from the same reading the arrow does"),

    # Scoped to the attribute: the function's own comment names both old labels, so a mutation that
    # only changed the string would still be satisfied by the prose.
    ("the label no longer says which end",
     [("'\u8df3\u5230\u8f68\u8ff9\u7684\u6700\u4e0a\uff08\u6700\u65e9\u4e00\u6761\u5df2\u52a0\u8f7d\u7684\u8bb0\u5f55\uff09'",
       "'\u8df3\u5230\u8f68\u8ff9\u7684\u9876\u90e8'")],
     "the control still says in words where a click would go"),

    ("the empty case leaves an arrow pointing nowhere",
     [("        button.hidden = empty;\n", "")],
     "the control is absent rather than wrong when there is nothing to jump between"),

    ("the glyph is rebuilt on every scroll position",
     [("        var current = button.firstElementChild;\n"
       "        if (!current || current.getAttribute('data-arrow') !== name) {\n",
       "        if (true) {\n")],
     "the glyph is not rebuilt on every scroll position"),

    # ---------- the reading ----------

    ("the end of the ledger is remembered instead of measured",
     [("var r = sentinel.getBoundingClientRect();", "var r = dom.ledgerEnd;")],
     "the end of the ledger is re-measured rather than remembered"),

    # The bug this rule exists for. `r.height > 0` is true of a one-pixel sentinel at every scroll
    # position, so the `||` made the reading constant and the arrow pointed up everywhere.
    ("one edge of the sentinel is enough",
     [("atLedgerEnd = r.top < viewH && r.bottom > 0;", "atLedgerEnd = r.height > 0 || r.top < viewH;")],
     "both edges are required, so a one-pixel sentinel cannot read as always present"),

    # ---------- the two targets ----------

    ("up goes to the top of the page",
     [("window.scrollTo(0, up ? ledgerTopOffset() : ledgerBottomOffset());",
       "window.scrollTo(0, 0);")],
     "the click never scrolls to the top of the document"),

    ("the two ends are swapped",
     [("window.scrollTo(0, up ? ledgerTopOffset() : ledgerBottomOffset());",
       "window.scrollTo(0, ledgerEndInView() ? ledgerBottomOffset() : ledgerTopOffset());")],
     "the click chooses between the two ends from the same reading the arrow does"),

    ("up is measured against the whole document",
     [("        var panel = dom.ledgerJump && typeof dom.ledgerJump.closest === 'function'\n"
       "          ? dom.ledgerJump.closest('.panel')\n"
       "          : null;\n",
       "        var panel = document.body;\n")],
     "up means the ledger panel, not the page"),

    ("up ignores the pinned band",
     [("return Math.max(0, top - pinnedBandBottom());", "return Math.max(0, top);")],
     "up clears the pinned band, measured rather than assumed"),

    ("the band clearance is measured off the wrong element",
     [("        if (!dom.filterSticky || typeof dom.filterSticky.getBoundingClientRect !== 'function') return 0;\n"
       "        var bottom = dom.filterSticky.getBoundingClientRect().bottom;",
       "        if (!dom.overview || typeof dom.overview.getBoundingClientRect !== 'function') return 0;\n"
       "        var bottom = dom.overview.getBoundingClientRect().bottom;")],
     "the band clearance is measured off the band itself"),

    ("down reads the last row instead of the sentinel",
     [("var bottom = sentinel.getBoundingClientRect().bottom", "var bottom = sentinel.lastElementChild.getBoundingClientRect().bottom")],
     "down means the sentinel at the ledger's own bottom"),

    ("the control is wired twice",
     [("        buildLedgerJump();\n", "        buildLedgerJump();\n        buildLedgerJump();\n")],
     "the jump is built once, on the wire path"),

    # ---------- the offset, and its one writer ----------

    ("the button is pinned to the viewport instead of the panel",
     [("        position: sticky;\n        bottom: calc(12px + var(--inspector-bottom-reserve, 0px));\n",
       "        position: fixed;\n        bottom: calc(12px + var(--inspector-bottom-reserve, 0px));\n")],
     "the button is sticky inside the panel rather than fixed on the viewport"),

    # The mutation that measured 35px of overlap at 12 of 18 scroll positions on a real session.
    ("the offset goes back to a number written down",
     [("bottom: calc(12px + var(--inspector-bottom-reserve, 0px));", "bottom: 12px;")],
     "the bottom offset is measured, not written down"),

    ("the button stops being a circle",
     [("        margin: 0 auto;\n        padding: 0;\n        border: 1px solid var(--mcode-border);\n"
       "        border-radius: 50%;\n",
       "        margin: 0 auto;\n        padding: 0;\n        border: 1px solid var(--mcode-border);\n"
       "        border-radius: 8px;\n")],
     "the button is a circle, which is what makes an arrow inside it read as a direction"),

    ("the button goes under the panel it has to clear",
     [("        z-index: 6;\n        display: grid;\n        place-items: center;\n", "        z-index: 2;\n        display: grid;\n        place-items: center;\n")],
     "the button is out-levelled above the panel it has to clear"),

    # `display: grid` beats the `hidden` attribute, so without this the empty case renders an empty
    # circle instead of nothing — the exact hole the markup's own comment is about.
    ("`hidden` loses to the button's own display",
     [("      .ledger-jump[hidden] {\n        display: none;\n      }\n", "")],
     "`hidden` still wins over the button's own display"),

    ("the button cannot be reached from the keyboard",
     [("      .ledger-jump:focus-visible {\n        outline: 2px solid var(--mcode-accent, currentColor);\n"
       "        outline-offset: 2px;\n      }\n", "")],
     "the button is reachable from the keyboard, with a ring that is its own"),

    ("a second writer of the offset",
     [("        scheduleInspectorBottomReserve();\n",
       "        scheduleInspectorBottomReserve();\n        document.documentElement.style.setProperty('--inspector-bottom-reserve', '0px');\n")],
     "the offset has exactly one writer"),

    ("the offset stops being the panel's own height",
     [("var panel = dom.inspectorPanel;\n          var reserve = 0;", "var panel = dom.ledgerJump;\n          var reserve = 0;")],
     "the writer is the function that already owns the panel's height"),

    # Measured in the same turn that toggled the dock class, the panel has not been laid out yet:
    # 177px against a panel that then rendered 360px.
    ("the offset is read before the panel has been laid out",
     [("        bottomReserveFrame = window.requestAnimationFrame(function () {\n          bottomReserveFrame = 0;\n",
       "        bottomReserveFrame = 0;\n        (function () {\n"),
      ("          document.documentElement.style.setProperty('--inspector-bottom-reserve', reserve + 'px');\n        });\n",
       "          document.documentElement.style.setProperty('--inspector-bottom-reserve', reserve + 'px');\n        })();\n")],
     "the offset is read after layout, in a later frame"),

    ("the dock stops re-measuring the offset",
     [("        scheduleInspectorBottomReserve();\n", "")],
     "the dock is what re-measures it"),

    # A poll rebuilds the ledger without firing any scroll event, so the observer alone leaves the
    # label describing the end the reader is no longer at.
    ("only a scroll re-labels the control",
     [("        setLedgerJumpLabel();\n\n        var groups = visibleTurns(windowed);",
       "        var groups = visibleTurns(windowed);")],
     "a render re-labels the control, not only a scroll"),
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