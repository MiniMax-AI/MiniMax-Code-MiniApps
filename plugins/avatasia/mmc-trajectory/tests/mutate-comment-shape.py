"""Mutation control for the comment-shape guard.

Three of these mutations are not invented. They are the exact shape the Stage 2-b probe left in
index.html above recordVisible(), visibleEntries() and spanPassesFilter(): a new `/**` written
above a function without the old one being removed. That shipped through 42 green guards, npm
run validate, a publish and a browser measurement, and was only found by scanning for two
openers in a row.

Each mutation therefore has to be caught by the assertion that names what it broke, not merely
by the guard going red — a guard that fails for an unrelated reason is not evidence about the
rule the mutation was written to break.
"""
import io
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CLIENT = os.path.join(ROOT, "miniapp", "client", "index.html")
PROBE = os.path.join(HERE, "verify-comment-shape.mjs")

OPEN_2B = "      /**\n       * Whether one record is in the current view"
OPEN_RULE = "      /**\n       * One rule, one answer."
CLOSE_COUNTS = ("       * @returns {{byRule: Object, unit: Object, any: number, "
                "selected: number, total: number}}\n       */")

MUTATIONS = [
    # What the probe actually did: the new block opener went in, the old one stayed.
    ("a second block opener on top of the first",
     OPEN_2B,
     OPEN_2B.split("\n")[0] + "\n" + OPEN_2B,
     ["no comment block opens on top of another",
      "openers and closers balance",
      "the file ends with every block closed"]),

    # The mirror image, and the one that would break the file outright.
    ("a second block closer on top of the first",
     CLOSE_COUNTS,
     CLOSE_COUNTS + "\n       */",
     ["no comment block closes on top of another"]),

    # An opener that documents nothing. Balanced, parseable, and attached to no declaration.
    ("an opener whose prose was replaced by code",
     OPEN_RULE,
     "      /**\n      function ruleTableIsEmpty() { return true; }",
     ["every opener on its own line is followed by its own prose"]),

    # Counts still balance here, so only the walk can see it.
    ("a closer that runs ahead of its opener",
     OPEN_RULE,
     "      */\n" + OPEN_RULE,
     ["no closer runs ahead of its opener"]),
]

original = io.open(CLIENT, encoding="utf-8", newline="").read()


def run():
    proc = subprocess.run(["node", PROBE], cwd=HERE,
                          capture_output=True, text=True, encoding="utf-8", errors="replace")
    return proc.stdout + proc.stderr


def listed():
    proc = subprocess.run(["node", PROBE, "--list"], cwd=HERE,
                          capture_output=True, text=True, encoding="utf-8", errors="replace")
    return proc.stdout.splitlines()


ok = True
baseline = run()
base_ok = "ALL PASSED" in baseline
print(("ok   " if base_ok else "FAIL ") + "baseline green")
ok = ok and base_ok

assertions = listed()
caught_all = []
for title, old, new, expects in MUTATIONS:
    if original.count(old) != 1:
        raise SystemExit("FAIL  anchor for %r matched %d times" % (title, original.count(old)))
    missing = [name for name in expects if name not in assertions]
    if missing:
        raise SystemExit("FAIL  %s is not an assertion in the guard: %s"
                         % (title, ", ".join(missing)))
    try:
        io.open(CLIENT, "w", encoding="utf-8", newline="").write(original.replace(old, new, 1))
        during = run()
        named = [name for name in expects if "FAIL " + name in during]
        failed = "ALL PASSED" not in during
        good = failed and len(named) == len(expects)
        print(("ok   " if good else "FAIL ") + "guard catches: " + title)
        for line in during.splitlines():
            if line.startswith("FAIL "):
                print("       " + line)
        caught_all.append(good)
    finally:
        io.open(CLIENT, "w", encoding="utf-8", newline="").write(original)

restored = io.open(CLIENT, encoding="utf-8", newline="").read()
after = run()
after_ok = "ALL PASSED" in after
print(("ok   " if restored == original else "FAIL ") + "client restored byte for byte")
print(("ok   " if after_ok else "FAIL ") + "green again after restore")

sys.exit(0 if (ok and all(caught_all) and restored == original and after_ok) else 1)