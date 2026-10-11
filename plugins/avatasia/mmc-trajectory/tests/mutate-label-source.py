"""Mutation control for the two label-source guards.

Without this, "kind button labels match KIND_LABELS" and "every kind button has a label
span" could both be satisfied by a page that has no drift because nothing ever drifted —
the same false green that let the 问答→答复 rename half-apply in the first place.
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
    ("markup label drifts from KIND_LABELS",
     '<span class="tbtn-label">\u7b54\u590d</span>',
     '<span class="tbtn-label">\u95ee\u7b54</span>',
     "kind button labels match KIND_LABELS"),
    ("a kind button loses its label span",
     '<span class="tbtn-label">\u601d\u8003</span>',
     '<span>\u601d\u8003</span>',
     "every kind button has a label span"),
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

caught_all = []
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
            if "label" in line and line.strip().startswith("-"):
                print("       " + line.strip())
        caught_all.append(named and failed)
    finally:
        io.open(CLIENT, "w", encoding="utf-8", newline="").write(original)

restored = io.open(CLIENT, encoding="utf-8", newline="").read()
after = run()
after_ok = "0 failed" in after
print(("ok   " if restored == original else "FAIL ") + "client restored byte for byte")
print(("ok   " if after_ok else "FAIL ") + "green again after restore")

sys.exit(0 if (ok and all(caught_all) and restored == original and after_ok) else 1)
