"""Mutation controls for the steer split and the turn classification.

Three mistakes worth being able to catch automatically:

  1. Filing every prompt in a turn as `user`. The count then reads as conversations but is
     really messages, and a turn can show three of them — the exact mismatch that sent
     someone looking for a mechanism.
  2. Filing 问答 as the turn *after* the question again, which puts the label on a turn while
     the reader still has not answered.
  3. Deciding the opener from the projected slice instead of the lineage. A steer whose turn
     opened in an earlier generation is then the only prompt the slice shows, so it reads as
     that turn's first prompt: counted as dialogue, and its turn filed 其他 instead of 对话.

All are one-line edits, which is exactly why they need a guard that has been seen to fail.
"""
import io
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SERVER = os.path.join(ROOT, "miniapp", "node", "server.mjs")
PROBE = os.path.join(HERE, "verify-generations.mjs")

# server.mjs is LF (pinned by .gitattributes). Build every multi-line anchor in the file's own
# line ending anyway: this script once read a CRLF working copy, and an anchor written with the
# other ending reads as "the rule drifted" and sends you off to re-find a rule that never moved.
original = io.open(SERVER, encoding="utf-8", newline="").read()
NL = "\r\n" if "\r\n" in original else "\n"


def anchored(*lines):
    return NL.join(lines)


OLD_STEER = anchored("        const opener = openerByTurn.get(turnKey);",
                     "        const steered = opener === undefined",
                     "          ? turn.records.some((r) => r.kind === 'user')",
                     "          : opener.row !== row;")
OLD_CONT = anchored("    } else if (closed) {",
                    "      turn.turnClass = 'continuation';",
                    "      continuationTurns += 1;")

MUTATIONS = [
    ("every prompt in a turn is counted as dialogue",
     OLD_STEER,
     "        const steered = false;",
     "a prompt written mid-turn is counted apart"),
    ("the first prompt of a turn is called a steer",
     OLD_STEER,
     "        const steered = true;",
     "the prompt that opened the turn is the only one counted as dialogue"),
    ("the opener is decided from the slice, not the lineage",
     OLD_STEER,
     anchored("        const opener = openerByTurn.get(turnKey);",
              "        const steered = turn.records.some((r) => r.kind === 'user');"),
     "the prompt alone in the slice is still a steer"),
    ("an opener outside the view counts as no opener at all",
     OLD_STEER,
     anchored("        const opener = openerByTurn.get(turnKey);",
              "        const steered = opener === undefined || opener.row === null",
              "          ? turn.records.some((r) => r.kind === 'user')",
              "          : opener.row !== row;"),
     "the prompt alone in the slice is still a steer"),
    ("Q and A goes back to the turn after the question",
     OLD_CONT,
     "    } else if (closed) {\n"
     "      turn.turnClass = 'qa';\n"
     "      continuationTurns += 1;\n"
     "      qaTurns += 1;",
     "the turn after it is a continuation, not a Q&A"),
    # A file that declares nothing used to be read as generation 0, which ended the walk and
    # turned every sealed generation the session had into an orphan.
    ("an active file with no marker starts the walk at generation 0 again",
     "  const activeGeneration = activeProbe.marker\n"
     "    ? activeProbe.marker.generation\n"
     "    : activeCatalogGeneration(null, catalog.generations) ?? 0;",
     "  const activeGeneration = activeProbe.marker ? activeProbe.marker.generation : 0;",
     "an active file with no marker still starts at the generation the catalog names"),
    ("a sealed file with no marker is refused again",
     "    const declared = parent.marker ? parent.marker.generation : want;",
     "    const declared = parent.marker ? parent.marker.generation : 0;",
     "a sealed snapshot reached at a generation it does not declare is still stitched"),
    # ...and the counter-example must keep passing, or the fix has quietly turned the catalog
    # into the authority: a file that DOES declare its generation still overrides it.
    ("the catalog overrides a file that declares its own generation",
     "  const activeGeneration = activeProbe.marker\n"
     "    ? activeProbe.marker.generation\n"
     "    : activeCatalogGeneration(null, catalog.generations) ?? 0;",
     "  const activeGeneration = activeCatalogGeneration(null, catalog.generations)\n"
     "    ?? (activeProbe.marker ? activeProbe.marker.generation : 0);",
     "a file that declares its own generation still wins over the catalog"),
]


def run():
    proc = subprocess.run(["node", PROBE], cwd=HERE,
                          capture_output=True, text=True, encoding="utf-8", errors="replace")
    return proc.stdout + proc.stderr


ok = True
baseline = run()
base_ok = "0 failed" in baseline
print(("ok   " if base_ok else "FAIL ") + "baseline green before any mutation")
ok = ok and base_ok

caught = []
for title, old, new, expect in MUTATIONS:
    if original.count(old) != 1:
        raise SystemExit("FAIL  anchor for %r matched %d times" % (title, original.count(old)))
    try:
        io.open(SERVER, "w", encoding="utf-8", newline="").write(original.replace(old, new, 1))
        during = run()
        named = expect in during
        failed = "0 failed" not in during
        print(("ok   " if (named and failed) else "FAIL ") + "guard catches: " + title)
        for line in during.splitlines():
            if line.strip().startswith("FAIL"):
                print("       " + line.strip())
        caught.append(named and failed)
    finally:
        io.open(SERVER, "w", encoding="utf-8", newline="").write(original)

restored = io.open(SERVER, encoding="utf-8", newline="").read()
print(("ok   " if restored == original else "FAIL ") + "server restored byte for byte")
after = run()
after_ok = "0 failed" in after
print(("ok   " if after_ok else "FAIL ") + "green again after restore")

sys.exit(0 if (ok and all(caught) and restored == original and after_ok) else 1)
