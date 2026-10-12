"""Break the scroll-intent chain in the shipped client and require verify-anchor-carry.mjs to
report each break by name.

The defect this guards (docs/LAYERS.md D14) had two halves and both were invisible: the capture
re-read the position every pass instead of carrying it, and the paths that end the ledger early
never dropped the intent. Each mutation below reproduces one of them, or the shape a future edit
would take that reintroduces it.

Anchors are multi-line and index.html is LF, so they are written with bare \\n and the file is read
and written with newline='' — matching on normalised text while preserving the file's own endings.
"""
import io
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CLIENT = os.path.join(os.path.dirname(HERE), "miniapp", "client", "index.html")
PROBE = os.path.join(HERE, "verify-anchor-carry.mjs")

# Every anchor below is a statement the rule is *written on*, not a phrase in its comment: a
# comment can be reworded without the rule changing, and an anchor that survives a reword is an
# anchor that will report drift the next time the comment is edited for real.
MUTATIONS = [
    # The original defect. Capturing unconditionally puts every pass back where the defect was:
    # reading a position the browser has already clamped to a document that no longer exists.
    ("the intent is re-read on every pass",
     [("        if (!pendingAnchor) {\n          pendingAnchor = { row: firstVisibleRow(), y: window.scrollY || window.pageYOffset || 0 };\n        }\n",
       "        pendingAnchor = { row: firstVisibleRow(), y: window.scrollY || window.pageYOffset || 0 };\n")],
     "a pass inside a chain re-uses the intent it was handed"),

    # Half of the same break: the row is carried, the pixel offset is not. The fallback only runs
    # when the anchor row is gone, so this is the rarer half — but it is the half that lands the
    # reader on the clamped position, which is the top of the document.
    ("the fallback offset is re-read instead of carried",
     [("        var scrollY = pendingAnchor.y;\n",
       "        var scrollY = window.scrollY || window.pageYOffset || 0;\n")],
     "the live position is read in exactly one place"),

    # The consuming half. Without it the intent stays armed, and the next chain starts by
    # re-anchoring on a position that was already spent.
    ("restoring does not consume the intent",
     [("      function restoreRowAnchor(anchor, fallbackY) {\n        forgetScrollAnchor();\n",
       "      function restoreRowAnchor(anchor, fallbackY) {\n")],
     "restoring consumes the intent"),

    # A second writer. forgetScrollAnchor() exists so that nulling it has one home; inlining the
    # assignment is how the next edit ends up with two places to keep in agreement.
    ("the intent is nulled inline as well",
     [("      function restoreRowAnchor(anchor, fallbackY) {\n        forgetScrollAnchor();\n",
       "      function restoreRowAnchor(anchor, fallbackY) {\n        pendingAnchor = null;\n")],
     "restoring consumes the intent"),

    # One of the five early returns stops dropping the intent. The ledger is left holding a block
    # rather than rows, so carrying an anchor measured against the previous table into whatever
    # comes next is applying a position to a different session or a different filter.
    ("an early return keeps the intent it cannot honour",
     [("          dom.ledgerMeta.textContent = '不可用';\n          forgetScrollAnchor();\n          return;\n",
       "          dom.ledgerMeta.textContent = '不可用';\n          return;\n")],
     "every early return after the clear drops the intent"),

    # The other kind of half-measure: the helper grows a second job. Nulling it is the whole
    # contract; a pass that also touches the reader's state would make the caller's intent
    # unreadable from the call.
    ("forgetScrollAnchor grows a second job",
     [("      function forgetScrollAnchor() {\n        pendingAnchor = null;\n      }\n",
       "      function forgetScrollAnchor() {\n        pendingAnchor = null;\n        state.selectedId = null;\n      }\n")],
     "forgetScrollAnchor nulls it and does nothing else"),
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