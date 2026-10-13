"""Shorten the session list's cache below the poll interval and require verify-list-cache.mjs to
report each way it comes back by name.

The defect is not a wrong number. It is a cache that outlives nothing: LIST_CACHE_TTL_MS was 1000
while the page polls every 2500 ms, so the list could not be hit even once between two consecutive
polls. Every tick walked the session tree again and reopened the runtime database, and measured on
the machine that reported it that was most of the 16 GB the miniapp process read in 68 minutes. No
guard asserted the relationship, so a value that silently disables the cache it belongs to cost
nothing to introduce and nothing to notice.

The mutations below are the ways back. Two of them (the TTL, the peek budget) are the original
defect and its quieter cousin; the other three are what has to survive for the first fix to mean
anything — a title read that still opens the database every poll is the same I/O wearing a new
constant, and a cache the dispose path forgets is the leak this project has already paid for once.

Anchors are multi-line and server.mjs is LF, so they are written with bare \\n and the file is read
and written with newline='' — matching on normalised text while preserving the file's own endings.
No anchor may contain a line ending of its own: one did, and it stopped resolving the moment the
.gitattributes pinning LF landed.
"""
import io
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN = os.path.dirname(HERE)
SERVER = os.path.join(PLUGIN, "miniapp", "node", "server.mjs")
PROBE = os.path.join(HERE, "verify-list-cache.mjs")

MUTATIONS = [
    # The defect verbatim: the cache is shorter than the interval that expires it, so it is never
    # hit. Not a slow cache — a cache that cannot be reached.
    ("the list TTL drops below the poll interval",
     [("const LIST_CACHE_TTL_MS = 3000;", "const LIST_CACHE_TTL_MS = 1000;")],
     "is at or above POLL_INTERVAL"),

    # The quieter cousin: the label and counters come from a prefix of messages.jsonl, and a
    # generation marker lives on the first row. Reading far past it costs a full page of I/O on
    # every miss to produce counts that were approximate to begin with.
    ("the list peek grows past the generation probe",
     [("const LIST_PEEK_BYTES = 64 * 1024;", "const LIST_PEEK_BYTES = 1024 * 1024;")],
     "stays within 4x GENERATION_PROBE_BYTES"),

    # Without this the first fix buys nothing: readSessionTitles opens the runtime database on every
    # call and the list route calls it once per poll, so the store keeps getting reopened even after
    # the walk stopped repeating.
    ("the titles read goes back to the database on every poll",
     [("const titles = await sessionTitles(",
       "const titles = await readSessionTitles(\n      location.root,")],
     "the list route reaches titles through the cache"),

    # ...and the cache that answers that poll is removed entirely.
    ("the title cache is removed",
     [("  let titleCache = { at: 0, key: '', map: new Map() };\n", "")],
     "the titles read is cached rather than taken from the database on every poll"),

    # The parsed-row cache leaked here once — a disposed runtime held ~43 MB for a 39 MB session —
    # and the line that fixed it is in server.mjs precisely so the next cache cannot repeat it.
    ("dispose stops releasing the title cache",
     [("titleCache = { at: 0, key: '', map: new Map() };\n    descriptorCache.clear();",
       "descriptorCache.clear();")],
     "dispose releases the title cache"),
]

original = io.open(SERVER, encoding="utf-8", newline="").read()


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
        io.open(SERVER, "w", encoding="utf-8", newline="").write(mutated)
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
        io.open(SERVER, "w", encoding="utf-8", newline="").write(original)

restored = io.open(SERVER, encoding="utf-8", newline="").read()
after_code, after = run()
after_ok = after_code == 0 and "0 failed" in after
print(("ok   " if restored == original else "FAIL ") + "server restored byte for byte")
print(("ok   " if after_ok else "FAIL ") + "green again after restore")

sys.exit(0 if (ok and all(caught) and restored == original and after_ok) else 1)
