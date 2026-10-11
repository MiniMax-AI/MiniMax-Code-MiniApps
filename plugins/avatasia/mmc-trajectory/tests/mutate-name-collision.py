"""Mutation control for the new "no record kind is labelled 问答" guard.

A guard that cannot fail proves nothing. Flip the real client source so a record kind
does claim 问答, confirm the guard fires, put the file back byte for byte, and confirm
it goes green again. If either half is skipped the assertion is worthless.
"""
import io
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CLIENT = os.path.join(ROOT, "miniapp", "client", "index.html")
PROBE = os.path.join(HERE, "client-check.mjs")

original = io.open(CLIENT, encoding="utf-8", newline="").read()
mutated = original.replace("reply: '\u7b54\u590d'", "reply: '\u95ee\u7b54'", 1)
if mutated == original:
    sys.exit("FAIL  anchor not found — the rename must land before this runs")


def run():
    proc = subprocess.run([sys.executable and "node", PROBE], cwd=HERE,
                          capture_output=True, text=True, encoding="utf-8", errors="replace")
    return proc.stdout + proc.stderr


try:
    # baseline
    baseline = run()
    ok_before = "0 failed" in baseline
    print(("ok   " if ok_before else "FAIL ") + "baseline green before mutation")

    # mutated
    io.open(CLIENT, "w", encoding="utf-8", newline="").write(mutated)
    during = run()
    # How many assertions this breaks depends on how far KIND_LABELS feeds the rest of the
    # page — renaming the label breaks the helper test, the static check, and the button-markup
    # comparison together, so it was 3 before anyone read the number. Test "not green" and
    # "the guard is named", not a hardcoded failure count that goes stale on the next change.
    named = "no record kind is labelled" in during
    failed = not ("0 failed" in during)
    caught = named and failed
    print(("ok   " if caught else "FAIL ") + "guard fires when a record kind claims 问答")
    for line in during.splitlines():
        if "问答" in line or "failed" in line:
            print("       " + line.strip())
finally:
    io.open(CLIENT, "w", encoding="utf-8", newline="").write(original)

restored = io.open(CLIENT, encoding="utf-8", newline="").read()
print(("ok   " if restored == original else "FAIL ") + "client source restored byte for byte")
after = run()
ok_after = "0 failed" in after
print(("ok   " if ok_after else "FAIL ") + "green again after restore")

sys.exit(0 if (ok_before and caught and restored == original and ok_after) else 1)
