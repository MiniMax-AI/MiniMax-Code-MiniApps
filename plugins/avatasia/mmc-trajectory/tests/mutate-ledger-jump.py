"""Mutation control for the ledger's two-ends control.

A guard that cannot fail is not a guard. Each mutation below breaks one of the rules in
verify-ledger-jump.mjs the way it would actually break in the file, and requires that guard to fail
with the right reason before the file is restored byte for byte.

Four of these break a bug that had already shipped once, so they are worth naming:

  * the flat `bottom: 12px` — a 35px overlap at 12 of 18 scroll positions on a real 22,527-message
    session, which the one position anybody spot-checked happened to be free of;
  * `window.scrollTo(0, 0)` for 「最上」 — the control claimed to go up and landed on the only screen
    in the app with no records on it;
  * `r.height > 0 || r.top < viewH` — the left term is true at every scroll position against a
    one-pixel sentinel, so the arrow pointed up everywhere. That one is a trivially-true term
    inside an `||`, which is the same defect as a tautology in an assertion: it looks like a test
    and measures nothing;
  * `!ledgerEndInView()` as the answer to 「还能往下跳」 — one boolean for two opposite states,
    「not reached yet」 and 「already gone past」, of which only the first means a downward jump is
    available. It is the only mutation here that no reachable scroll position can catch, and that is
    the point of keeping it: the inspector column is capped against the viewport, so the ledger
    always outgrows it and the second state never arises. A wrong answer the layout never asks for
    is still a wrong answer, and a guard that only pins reachable behaviour would not notice.

One breaks the rule this control's own reason for existing, which is why the offset writer is
asserted to have exactly one owner. A second writer of `--inspector-bottom-reserve` is a number
written twice from two places that each believe they own it, which is the shape every two-writer
defect in this client has taken.

Withdrawn with their rule, not deleted in passing. Three mutations used to guard `ledgerJumpUsed`,
a flag that remembered whether the reader had pressed the control once. The flag's rule — 「the
first press is special」 — is gone with the rule that replaced it: the arrow has an answer before
anyone touches anything, so there is no first press to be special. Its assertions and its mutations
were withdrawn together; keeping a mutation for a rule nobody holds is a test of nothing.
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
     [('<button type="button" class="ledger-jump" id="ledger-jump" hidden aria-label="跳到轨迹的最低"></button>',
       '<button type="button" class="ledger-jump" id="ledger-jump" hidden aria-label="跳到轨迹的最低">到最低</button>')],
     "the jump button ships with no text in it"),

    ("the button ships visible, before it has anything to show",
     [('id="ledger-jump" hidden aria-label=', 'id="ledger-jump" aria-label=')],
     "the jump button ships hidden, so there is no empty circle on first paint"),

    ("the button is not typed as a button",
     [('<button type="button" class="ledger-jump"', '<button class="ledger-jump"')],
     "the jump button is a button and not a link, so Enter and Space both work"),

    ("the button announces nothing",
     [(' hidden aria-label="跳到轨迹的最低"', ' hidden')],
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
      ('<button type="button" class="ledger-jump" id="ledger-jump" hidden aria-label="跳到轨迹的最低"></button>',
       '<button type="button" class="ledger-jump" id="ledger-jump" hidden aria-label="跳到轨迹的最低"></button>\n          <div class="ledger-end" id="ledger-end" aria-hidden="true"></div>')],
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
     [("          var glyph = icon(name);\n", "          var glyph = document.createTextNode('到最低');\n")],
     "the control shows an arrow rather than a word"),

    # Re-anchored 2026-10-14 (D46, then D47). The arrow reads `ledgerJumpGoesUp()` rather than a
    # constant, and D47 moved the reading inside that function from 「at the end」 to 「which way the
    # reader is going, unless an end says otherwise」. The job is unchanged — the arrow still follows
    # a reading rather than a constant — so the mutation is the same one pointed at the line that
    # now carries it.
    ("the arrow stops following the reading",
     [("var name = up ? 'arrowUp' : 'arrowDown';", "var name = 'arrowDown';")],
     "the reading that picks the arrow exists and is the one the label reads"),

    # ---- D47: which way the reader is going ----

    # A default instead of an unset value. With `down` written into the variable, the third state
    # is gone: the first paint no longer distinguishes 「the reader has not moved」 from 「the reader
    # is going down」, and whichever the reader actually did first is no longer what decides.
    ("the direction starts as a default instead of nothing",
     [("var ledgerScrollDir = null;", "var ledgerScrollDir = 'down';")],
     "the direction has a third, unset value rather than a default one"),

    # The withdrawn flag, back as a live variable. Its rule is gone, so a writer for it is a
    # partial revert: the control would again answer 「not yet pressed」 to a question it no longer
    # asks, and nobody reading the file could tell which of the two rules is in force.
    ("the withdrawn first-press flag comes back",
     [("var ledgerScrollDir = null;", "var ledgerScrollDir = null;\n      var ledgerJumpUsed = false;")],
     "the withdrawn first-press flag is gone and stays gone"),

    # ---- D47: the reading ----

    ("the end of the ledger is remembered instead of measured",
     [("var r = sentinel.getBoundingClientRect();", "var r = dom.ledgerEnd;")],
     "whether the end is still below the fold is re-measured rather than remembered"),

    # The bug this rule exists for, in its new shape. One edge of the sentinel is always past the
    # fold or never, so the `&&` became a single test and the branch answered 「still below」 at
    # every scroll position.
    ("one edge of the sentinel is enough",
     [("return r.top >= viewH && r.bottom > viewH;", "return r.bottom > viewH;")],
     "both edges are required, so a one-pixel sentinel cannot read as always below"),

    # The old predicate, restored. Reads correctly at every position the shipped layout can
    # produce, because the ledger always outgrows the capped inspector column — and answers 「yes,
    # go down」 to a reader who has already scrolled past the end, which sends a down arrow upwards.
    ("the end is asked about by being absent from the viewport",
     [("var canDown = ledgerEndBelow();", "var canDown = !ledgerEndBelow();")],
     "the end is asked about by position below the fold, not by being absent from the viewport"),

    # The observer carrying a flag again. The predicate re-measures, so the flag has no reader —
    # and a writer with no reader is the first half of a two-writer defect.
    ("the observer carries a flag nothing else reads",
     [("ledgerEndObserver = new IntersectionObserver(function () {",
       "ledgerEndObserver = new IntersectionObserver(function (entries) {\n          atLedgerEnd = entries[0].isIntersecting;")],
     "the observer triggers a re-read instead of carrying a flag nothing else reads"),

    # ---- D47: the four named branches ----

    # The order is the rule. Both `&&` terms hold, so the second one decides alone and the
    # degenerate case — the one the old flag used to break the tie on — is decided by a branch that
    # was not meant to see it.
    ("the degenerate case is decided after a case that can pre-empt it",
     [("        if (!canUp && !canDown) return false; // the whole ledger is on screen: nothing to jump to\n"
       "        if (!canDown) return true;           // the end is reached or gone past: up is all that is left\n",
       "        if (!canDown) return true;           // the end is reached or gone past: up is all that is left\n"
       "        if (!canUp && !canDown) return false; // the whole ledger is on screen: nothing to jump to\n")],
     "the degenerate case comes first: a ledger that fits on screen has nothing to jump to"),

    # 「已经到底端」 answered with the opposite arrow. On a ledger that fits on screen this makes
    # the control a 「go to where you already are」 button, which is what the whole arrow design
    # exists to prevent.
    ("an end that is in view answers down",
     [("        if (!canDown) return true;           // the end is reached or gone past: up is all that is left",
       "        if (!canDown) return false;          // the end is reached or gone past: up is all that is left")],
     "an end that is in view or already passed leaves up as the only move"),

    # The veto dropped: a reader who is still above the ledger's top gets an up arrow, and pressing
    # it scrolls them up out of the trajectory entirely.
    ("the top's veto is dropped",
     [("        if (!canUp) return false;             // the top is in view: down is the only move left\n", "")],
     "a top that is in view leaves down as the only move"),

    # The whole rule collapsed back into two terms. Reads fine, answers correctly at every position
    # the shipped layout produces, and hands the both-ends-off-screen case to whichever term happens
    # to be evaluated first — silently, and with no line anywhere saying so.
    ("the rule is collapsed into two terms",
     [("return ledgerScrollDir === 'up';", "return ledgerScrollDir === 'up' && canUp;")],
     "the rule is not collapsed into two terms whose order would decide a case silently"),

    # ---- D47: the scroll listener ----

    # Nothing on the page says which way the reader went, so the arrow sits at whatever the last
    # render said while the reader scrolls through 200 records. The registration goes, not the
    # function: deleting the handler too would be caught by generation-pin for the wrong reason and
    # would prove nothing about the direction.
    ("nothing listens to the scroll",
     [("window.addEventListener('scroll', ledgerJumpOnScroll, { passive: true });",
       "window.listenNothing = ledgerJumpOnScroll;")],
     "a scroll listener supplies the direction, since nothing else says which way the reader went"),

    # A remembered position is not a direction until it is subtracted. A constant is not one at all.
    ("the direction stops being a comparison",
     [("ledgerScrollDir = y < ledgerLastY ? 'up' : 'down';", "ledgerScrollDir = 'up';")],
     "the direction is the sign of the scroll delta, and the last position is remembered"),

    # No seed, so the first scroll after load compares the reader's position against `null` — which
    # is not a position — and the first arrow of the session answers for a direction nobody took.
    ("the last position is never seeded",
     [("        ledgerLastY = window.scrollY || window.pageYOffset || 0;\n", "")],
     "the last position is seeded at build time so the first scroll has something to compare"),

    # Without `passive` the browser must wait to see whether the handler scrolls before it can
    # scroll the page — on the one surface in this app that is measured at 617 ms of layout a frame.
    ("the listener stops being passive",
     [("window.addEventListener('scroll', ledgerJumpOnScroll, { passive: true });",
       "window.addEventListener('scroll', ledgerJumpOnScroll);")],
     "the listener is passive, because nothing inside it writes scroll"),

    # The batching removed: a scroll event fires more often than a frame, so the predicate's
    # getBoundingClientRect runs once per event instead of once per frame.
    ("the label is relabelled on every scroll event instead of once a frame",
     [("          scheduleLedgerJumpLabel();", "          setLedgerJumpLabel();")],
     "the label is relabelled through a frame, so a scroll costs one layout read rather than one per event"),

    # The signal hoisted onto <body>. Withdrawn once already for a control's visibility, and it is
    # the same shape here: a second thing on the page would now be able to read another layer's
    # scroll state. What changed is the use, not the signal — this is the orientation of a
    # navigation affordance and nothing else reads it — so the mutation stays as the record of
    # where the line was drawn.
    ("the direction is published on <body>",
     [("          ledgerScrollDir = y < ledgerLastY ? 'up' : 'down';",
       "          ledgerScrollDir = y < ledgerLastY ? 'up' : 'down';\n          document.body.classList.add('is-reading-down');")],
     "the direction stays inside this control instead of being published on <body>"),

    # ---- D47: the press ----

    # Scoped to the attribute: the function's own comment names both old labels, so a mutation that
    # only changed the string would still be satisfied by the prose.
    ("the label no longer says which end",
     [("'跳到轨迹的最上（最早一条已加载的记录）'", "'跳到轨迹的顶部'")],
     "the control still says in words where a click would go"),

    ("the empty case leaves an arrow pointing nowhere",
     [("        button.hidden = empty;\n", "")],
     "the control is absent rather than wrong when there is nothing to jump between"),

    ("the glyph is rebuilt on every scroll position",
     [("        var current = button.firstElementChild;\n"
       "        if (!current || current.getAttribute('data-arrow') !== name) {\n",
       "        if (true) {\n")],
     "the glyph is not rebuilt on every scroll position"),

    # A jump IS a movement, and the reader did not scroll themselves. Without the write the glyph
    # keeps answering for wherever the last self-driven scroll left the direction — and a press
    # toward the end the reader is already at fires no scroll event at all, so nothing ever
    # corrects it.
    ("the press forgets the direction it just jumped",
     [("          ledgerScrollDir = up ? 'up' : 'down';\n", "")],
     "the press records the direction it just jumped, because the reader did not scroll themselves"),

    # The two lines in the wrong order. This is the original bug re-created from the inside: write
    # the direction first, then ask, so the press consults a state it has just changed itself — and
    # the direction it then writes is derived from that answer, twice over. The `up ?` scroll is
    # left alone on purpose, so this breaks the ORDER and nothing else: a mutation that removed the
    # destination line as well would be caught by a different rule and prove less.
    ("the direction is written before the destination is chosen",
     [("          var up = ledgerJumpGoesUp();\n"
       "          window.scrollTo(0, up ? ledgerTopOffset() : ledgerBottomOffset());\n",
       "          ledgerScrollDir = 'down';\n"
       "          var up = ledgerJumpGoesUp();\n"
       "          window.scrollTo(0, up ? ledgerTopOffset() : ledgerBottomOffset());\n")],
     "the destination is chosen before the direction is written"),

    # The glyph and the scroll each read the reading themselves. They agree today because they are
    # the same call — and that is exactly why letting them drift is the one thing not to allow.
    ("the click stops reading what the arrow reads",
     [("          var up = ledgerJumpGoesUp();\n"
       "          window.scrollTo(0, up ? ledgerTopOffset() : ledgerBottomOffset());",
       "          window.scrollTo(0, ledgerBottomOffset());")],
     "the click chooses between the two ends from the same reading the arrow does"),

    # `scrollTo()` does not fire the scroll event synchronously, and fires none at all when the
    # press targets the end the reader is already at — so the arrow would sit on the old reading
    # for the whole of the jump.
    ("the press leaves the arrow to the scroll it just caused",
     [("          ledgerScrollDir = up ? 'up' : 'down';\n          setLedgerJumpLabel();",
       "          setLedgerJumpLabel();\n          ledgerScrollDir = up ? 'up' : 'down';")],
     "the press relabels the arrow itself instead of waiting for a scroll event"),

    # ---------- the two targets ----------

    ("up goes to the top of the page",
     [("window.scrollTo(0, up ? ledgerTopOffset() : ledgerBottomOffset());",
       "window.scrollTo(0, 0);")],
     "the click never scrolls to the top of the document"),

    ("the two ends are swapped",
     [("window.scrollTo(0, up ? ledgerTopOffset() : ledgerBottomOffset());",
       "window.scrollTo(0, ledgerEndBelow() ? ledgerBottomOffset() : ledgerTopOffset());")],
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

    # A poll rebuilds the ledger without firing any scroll event, so the scroll listener alone
    # leaves the label describing the end the reader is no longer at.
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
