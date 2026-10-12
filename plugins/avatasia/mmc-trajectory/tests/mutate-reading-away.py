"""Break the scroll-driven stepping-aside in the shipped client and require verify-reading-away.mjs
to report each break by name.

The behaviour here is checked by running the handler, so most of these mutations have to change what
it *does*, not what it looks like: a version that keeps every declaration and loses the veto, the
threshold or the jump guard fails here rather than passing a source-shaped guard.

Each one is a way this can go wrong on a page with two particular properties — it scrolls itself
during every ledger rebuild, and it measures the height of the band it hides something inside.

Anchors are multi-line and index.html is LF, so they are written with bare \\n and the file is read
and written with newline='' — matching on normalised text while preserving the file's own endings.
"""
import io
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CLIENT = os.path.join(os.path.dirname(HERE), "miniapp", "client", "index.html")
PROBE = os.path.join(HERE, "verify-reading-away.mjs")

MUTATIONS = [
    # The mistake this whole file exists to catch. `display: none` takes the control out of layout,
    # so the band's offsetHeight — which syncStickyOffsets() reads and three pinned strips are
    # positioned from — becomes a function of scroll direction, and every scroll frame forces a
    # re-measure and a re-layout of everything pinned below.
    ("stepping aside takes the picker out of layout, so the band height follows the scroll",
     [("        opacity: 0;\n        visibility: hidden;\n", "        display: none;\n")],
     "stepping aside uses visibility, not display, so the band height cannot depend on scroll"),

    # The opposite mistake, and the more seductive one: opacity alone looks identical on screen and
    # leaves the control focusable and announced. Invisible but still in the tab order is worse than
    # either visible or hidden.
    ("stepping aside only fades, leaving the picker focusable and announced",
     [("        opacity: 0;\n        visibility: hidden;\n", "        opacity: 0;\n")],
     "stepping aside uses visibility, not display, so the band height cannot depend on scroll"),

    # visibility flipping at once on the way out blanks the control first and leaves a keyboard
    # reader focused on nothing for the length of the fade.
    ("the hidden state blanks the picker before it has finished fading",
     [("        transition: opacity 140ms ease, visibility 0s linear 140ms;\n",
       "        transition: opacity 140ms ease, visibility 0s linear 0s;\n")],
     "the hidden state delays visibility until the fade is over"),

    # The same property with the delay left on the way *in*, which hides the fade-in entirely: the
    # control only becomes visible once it is already fully opaque.
    ("the shown state reveals the picker after the fade, so the fade-in is never seen",
     [("        transition: opacity 140ms ease, visibility 0s linear 0s;\n",
       "        transition: opacity 140ms ease, visibility 0s linear 140ms;\n")],
     "the shown state reveals visibility at once, or the fade-in would be invisible"),

    # Coming back to the top is one large delta. Without this branch ahead of the jump guard, the
    # return trip is dismissed as "not a scroll" and the picker stays hidden at the one place it is
    # supposed to be visible.
    ("a return to the top of the document is dismissed as a jump",
     [("        if (y <= SHOW_EPS_PX) { downRun = 0; setReadingDown(false); return; }\n", "")],
     "coming back to the top shows it, even though that is one large jump"),

    # restoreRowAnchor() moves the window on every rebuild. Read as a direction, a 700px jump puts
    # the picker away while the reader was doing nothing at all.
    ("a ledger rebuild's scroll jump is read as the reader heading down",
     [("        if (Math.abs(delta) > SCROLL_JUMP_PX) { downRun = 0; return; }\n", "")],
     "a 900px jump is not a scroll: nothing was read, so nothing is put away"),

    # Getting the control back costs an upward scroll, so the threshold has to be long enough that
    # settling into the ledger never pays for it.
    ("the picker is put away on the first downward pixel",
     [("        if (downRun >= READ_AWAY_PX) setReadingDown(true);\n",
       "        if (downRun >= 0) setReadingDown(true);\n")],
     "a 200px settle leaves the picker alone — the cost of getting it back has to be worth it"),

    # A control that stays away from someone who has just reversed direction is not being discreet.
    ("an upward scroll leaves it hidden",
     [("          downRun = 0;\n          setReadingDown(false);\n          return;\n", "          downRun = 0;\n          return;\n")],
     "any upward movement brings it straight back"),

    # The banner naming a pinned generation sits directly under this control. A picker that steps
    # out from under its own banner leaves the banner pointing at a change nobody can undo.
    ("a pinned generation no longer vetoes stepping aside",
     [("        if (state.generation !== null) return false;\n", "")],
     "a pinned generation vetoes stepping aside — its banner points at the control"),

    # A keyboard reader who tabbed to it must not have it vanish under the cursor.
    ("focus inside the picker no longer vetoes stepping aside",
     [("        if (tailHasFocus()) return false;\n", "")],
     "focus inside the picker vetoes stepping aside"),

    # Dropping the vetoes wholesale is the version that reads as "the handler works" while hiding
    # the control from exactly the readers who need it.
    ("the downward path stops consulting the vetoes at all",
     [("        if (!mayStepAside()) { downRun = 0; return; }\n", "")],
     "a downward frame consults the vetoes before putting the picker away"),

    # A scroll listener that can delay the scroll is a layout-thrash source on a page whose scroll
    # path is already the subject of D12 and D15.
    ("the scroll listener can delay the scroll it is reading",
     [("window.addEventListener('scroll', scheduleReadingDown, { passive: true });",
       "window.addEventListener('scroll', scheduleReadingDown);")],
     "the scroll listener is passive, so it cannot delay the scroll it is reading"),

    # Deciding per event rather than per frame: a reader's scroll fires dozens of events between
    # two paints, and each one would re-read and re-toggle.
    ("the handler decides on every event instead of once per frame",
     [("      function scheduleReadingDown() {\n        if (scrollFrame !== null) return;\n",
       "      function scheduleReadingDown() {\n")],
     "the handler coalesces into one frame rather than deciding per event"),

    # Without the baseline the first event after a reload at depth reads as one enormous downward
    # delta — the picker is put away before the reader has touched anything.
    ("the scroll position is never baselined, so the first event reads as a huge delta",
     [("        lastScrollY = window.scrollY || window.pageYOffset || 0;\n", "")],
     "the scroll baseline is taken before the listener is attached"),

    # A poll re-renders every 2.5s. If render() owned this state, a reader holding still would have
    # the picker blink back every few seconds.
    ("a poll re-renders the state and blinks the picker back",
     [("      function render() {\n        renderBars();\n",
       "      function render() {\n        setReadingDown(false);\n        renderBars();\n")],
     "no render path writes the stepping-aside state, so a poll cannot blink it back"),
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
