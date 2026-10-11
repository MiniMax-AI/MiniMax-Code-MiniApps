"""Mutation control for the window guards.

A guard that cannot fail is not a guard. Each mutation below breaks one of the new rules in
the way it would actually break in the file — the default opening on 全部 again, the label going
back to naming the state, a reset hard-coding a literal, the scroll creeping back into the click
handler, the [hidden] patch being dropped, and a poll undoing a widened window.
"""
import io
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CLIENT = os.path.join(ROOT, "miniapp", "client", "index.html")
PROBE = os.path.join(HERE, "client-check.mjs")

MUTATIONS = [
    # 全部 is opt-in because it froze the page: ~9,900 rows and ~57,000 real DOM elements with
    # no virtual scrolling, rebuilt every 2.5s poll. Opening on it by default is the regression.
    ("default opened on 全部 again",
     "        allRecords: false,",
     "        allRecords: true,",
     "the window opens on the newest page, and the button names the action"),
    ("default opened on 全部's uncapped limit",
     "        limit: PAGE_STEP,",
     "        limit: Infinity,",
     "the window opens on the newest page, and the button names the action"),
    ("the shared default constant diverges from the state default",
     "      var DEFAULT_WINDOW_MODE = 'latest';",
     "      var DEFAULT_WINDOW_MODE = 'all';",
     "the window opens on the newest page, and the button names the action"),
    # The label shipped naming the state, which put 只看最新 200 条 directly above 已显示 200 条 —
    # the button echoing the count beside it. It must name the action, and in both directions.
    ("button label reverts to naming the state",
     "parts.mode.textContent = state.allRecords ? '显示最新 ' + formatInt(PAGE_STEP) + ' 条' : '显示全部';",
     "parts.mode.textContent = state.allRecords ? '已显示全部' : '只看最新 ' + formatInt(PAGE_STEP) + ' 条';",
     "the window opens on the newest page, and the button names the action"),
    ("button label arms swapped",
     "parts.mode.textContent = state.allRecords ? '显示最新 ' + formatInt(PAGE_STEP) + ' 条' : '显示全部';",
     "parts.mode.textContent = state.allRecords ? '显示全部' : '显示最新 ' + formatInt(PAGE_STEP) + ' 条';",
     "the window opens on the newest page, and the button names the action"),
    # aria-pressed stays on the state, which is why the accessible name repeats it.
    ("pressed state inverted away from the state it reports",
     "parts.mode.setAttribute('aria-pressed', state.allRecords ? 'true' : 'false');",
     "parts.mode.setAttribute('aria-pressed', state.allRecords ? 'false' : 'true');",
     "the window opens on the newest page, and the button names the action"),
    # The accessible name is what a screen reader reads first, so it has to carry the state.
    ("accessible name loses the state",
     "var modeLabel = state.allRecords ? '正在显示全部记录 · 点击改为只显示最新 ' + formatInt(PAGE_STEP) + ' 条'",
     "var modeLabel = state.allRecords ? '显示全部'",
     "the window opens on the newest page, and the button names the action"),
    ("quiet styling inverted with the arms",
     "parts.mode.classList.toggle('btn-quiet', state.allRecords);",
     "parts.mode.classList.toggle('btn-quiet', !state.allRecords);",
     "the window opens on the newest page, and the button names the action"),
    # A reset that preserves the window it is resetting is the bug this helper exists to prevent.
    ("reset reads the window it is discarding",
     "        setWindowMode(DEFAULT_WINDOW_MODE);",
     "        setWindowMode(state.allRecords ? 'all' : 'latest');",
     "every window reset quotes the default, not a literal"),
    # One reset going back to a literal is how the flipped default was left half-applied.
    # Anchored on the onKindToggle reset, whose following line makes it unique.
    ("one reset hard-codes the old mode",
     "        resetWindowMode();\n        syncKindButtons();",
     "        setWindowMode('latest');\n        syncKindButtons();",
     "every window reset quotes the default, not a literal"),
    # The scroll, back. It threw away whatever the reader had on screen.
    ("the window button scrolls to the tail again",
     "          setWindowMode(state.allRecords ? 'latest' : 'all');\n          renderLedger();",
     "          setWindowMode(state.allRecords ? 'latest' : 'all');\n          renderLedger();\n          window.scrollTo(0, document.documentElement.scrollHeight);",
     "the window button does not scroll the page"),
    # Drop the [hidden] patch on .btn and `hidden` loses to display:inline-flex, so the
    # load-more button comes back as a bordered empty box on load.
    ("the .btn hidden patch removed",
     "      .btn[hidden] {\n        display: none;\n      }\n\n",
     "",
     "a .btn toggled with hidden is actually hidden"),
    # Guard the label again, so the button is blank whenever it is showing.
    ("load-more label written only when showing",
     "        parts.more.textContent = '向上加载更早的 ' + formatInt(Math.min(PAGE_STEP, Math.max(hiddenAbove, 0))) + ' 条';",
     "        if (hiddenAbove > 0) {\n          parts.more.textContent = '向上加载更早的 ' + formatInt(Math.min(PAGE_STEP, hiddenAbove)) + ' 条';\n        }",
     "a .btn toggled with hidden is actually hidden"),
    # The dead button: Infinity + 200 is still Infinity, so the click would do nothing.
    ("load-more tries to load while showing everything",
     "          if (state.allRecords) return;\n          state.limit += PAGE_STEP;",
     "          state.limit += PAGE_STEP;",
     "the load-more button does nothing in 全部 instead of pretending to"),
    # The reason 向上加载更早的 N 条 never worked: the next poll reset the limit the reader had
    # just widened. This session grows fast enough that the count barely moved, so it looked
    # like a no-op rather than like a bug.
    #
    # Anchored on the guard line alone. It used to be anchored on the two lines above it as one
    # block, but rePinWindow gained a time-range early-return between them, so the block stopped
    # matching even though neither line moved. The rule is the one line.
    ("a poll resets a window the reader widened",
     "        if (state.limit > PAGE_STEP) return state.limit;",
     "",
     "a poll does not undo a window the reader widened"),
]

original = io.open(CLIENT, encoding="utf-8", newline="").read()


def run():
    proc = subprocess.run(["node", PROBE], cwd=HERE,
                          capture_output=True, text=True, encoding="utf-8", errors="replace")
    return proc.stdout + proc.stderr


ok = True
baseline = run()
base_ok = "0 failed" in baseline
print(("ok   " if base_ok else "FAIL ") + "baseline green")
ok = ok and base_ok

caught = []
for title, old, new, expect in MUTATIONS:
    if original.count(old) != 1:
        raise SystemExit("FAIL  anchor for %r matched %d times" % (title, original.count(old)))
    try:
        io.open(CLIENT, "w", encoding="utf-8", newline="").write(original.replace(old, new, 1))
        during = run()
        named = expect in during
        failed = "0 failed" not in during
        print(("ok   " if (named and failed) else "FAIL ") + "guard catches: " + title)
        for line in during.splitlines():
            if line.strip().startswith("-") and "window" in line:
                print("       " + line.strip())
        caught.append(named and failed)
    finally:
        io.open(CLIENT, "w", encoding="utf-8", newline="").write(original)

restored = io.open(CLIENT, encoding="utf-8").read()
after = run()
after_ok = "0 failed" in after
print(("ok   " if restored == original else "FAIL ") + "client restored byte for byte")
print(("ok   " if after_ok else "FAIL ") + "green again after restore")

sys.exit(0 if (ok and all(caught) and restored == original and after_ok) else 1)
