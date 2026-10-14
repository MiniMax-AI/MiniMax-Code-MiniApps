"""Break countRolesInPrefix's allocation-free rewrite in the shipped source and require
verify-count-roles.mjs to report each way it comes back by name.

The rewrite replaced five `matchAll` passes over the session list's prefix — a match object per
hit, thousands of them per session per rebuild — with four `test`-driven scans that read each value
out of the text by position. That trade is only worth making if the function still returns the same
eight counters, because the list sends them to the reader. So every mutation below is either the
counting drifting from what it was, or the allocation coming back.

The `lastIndex` resets are the ones worth reading twice. These are module-level `/g` regexes driven
with `test`, which mutates `lastIndex` — and the loops `break` out when a value has no closing
quote, which is the normal case for a truncated prefix and which leaves the cursor mid-string. A
scan that runs to exhaustion resets itself on the way out; a broken one does not. Drop one reset and
the *next* call counts from wherever the last one stopped, on the same shared regex, with no error.

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
PROBE = os.path.join(HERE, "verify-count-roles.mjs")

MUTATIONS = [
    # ---- the resets on shared module state ----
    #
    # Each of these leaves a scan's lastIndex pointing into the middle of the previous call's
    # string whenever that call hit a truncated value. The guard catches all three with one named
    # assertion, because the case that fails is the same one each time: a complete scan after a
    # truncated one.

    ("the role scan stops resetting its cursor",
     [("  ROLE_SCAN.lastIndex = 0;\n", "")],
     "ROLE_SCAN is reset before it is scanned"),

    ("the turn scan stops resetting its cursor",
     [("  TURN_SCAN.lastIndex = 0;\n", "")],
     "TURN_SCAN is reset before it is scanned"),

    ("the block scan stops resetting its cursor",
     [("  BLOCK_SCAN.lastIndex = 0;\n", "")],
     "BLOCK_SCAN is reset before it is scanned"),

    # ---- the value is matched exactly, not by prefix ----
    #
    # `user2` and `users` are not `user`. The capturing version could not get this wrong because
    # its alternation closed the value; a position-based comparison that only checks `startsWith`
    # can, and then reports messages the session does not have.

    ("a value is matched by prefix rather than exactly",
     [("  const valueIs = (start, literal) => text.startsWith(literal, start)\n"
       "    && start + literal.length === valueEnd;",
       "  const valueIs = (start, literal) => text.startsWith(literal, start);")],
     "roles outside the four are not counted"),

    # ---- a role outside the four is not a role the list counts ----
    #
    # The capturing version's alternation was the filter. Removing the `custom` branch and letting
    # anything left over fall into the else counts `system`, `tool` and every future value as
    # system messages — the else that used to mean exactly one thing.

    ("a role outside the four falls into the system count",
     [("    else if (valueIs(start, 'custom')) counts.systemMessages += 1;",
       "    else counts.systemMessages += 1;")],
     "roles outside the four are not counted"),

    # ---- a truncated value is not a value ----
    #
    # The prefix is a prefix: the last line is routinely cut mid-field. Slicing to the end of the
    # string instead of to the closing quote invents a turn id out of whatever follows.

    ("a truncated turn id is counted as if it closed",
     [("    const end = text.indexOf('\"', start);\n"
       "    if (end < 0) break;\n"
       "    turnIds.add(text.slice(start, end));",
       "    turnIds.add(text.slice(start));")],
     "truncated inside a turn id"),

    # ---- turns are counted distinctly ----
    #
    # The same turn id is on every row of that turn, so a prefix with 40 rows and 4 turns reports
    # 4. Counting rows instead reports 40, and the list prints it.

    ("turns are counted per row rather than per distinct id",
     [("  const turnIds = new Set();", "  let turnIds = 0;"),
      ("    turnIds.add(text.slice(start, end));", "    turnIds += 1;"),
      ("  counts.turns = turnIds.size;", "  counts.turns = turnIds;")],
     "duplicate turn ids count once"),

    # ---- the key needs its colon ----
    #
    # `{"note":"message_id"}` has the word but not the field, and the capturing pattern required
    # the colon so it counted nothing. The obvious "even cheaper" rewrite is `indexOf` on the bare
    # word, which counts every mention of it anywhere in the file.

    ("message_id is counted by the bare word rather than as a key",
     [("  MESSAGE_ID_SCAN.lastIndex = 0;\n  while (MESSAGE_ID_SCAN.test(text)) counts.messages += 1;",
       "  let at = text.indexOf('\"message_id\"');\n"
       "  while (at >= 0) { counts.messages += 1; at = text.indexOf('\"message_id\"', at + 12); }")],
     "message_id as a value without a colon"),

    # ---- and the allocation the rewrite was for ----
    #
    # Back to one capturing pass. Correct, and the original: a match object per hit, which on a
    # 64 KB prefix is a few thousand per session per rebuild.

    ("one scan goes back to a capturing pass",
     [("  MESSAGE_ID_SCAN.lastIndex = 0;\n  while (MESSAGE_ID_SCAN.test(text)) counts.messages += 1;",
       "  for (const match of text.matchAll(/\"message_id\"\\s*:/g)) counts.messages += 1;")],
     "the counting loops do not build a match object per hit"),

    # Half of that rewrite: still allocation-free, but only counting three of the four fields.
    ("a whole scan is dropped",
     [("  BLOCK_SCAN.lastIndex = 0;\n"
       "  while (BLOCK_SCAN.test(text)) {\n"
       "    const start = BLOCK_SCAN.lastIndex;\n"
       "    valueEnd = text.indexOf('\"', start);\n"
       "    if (valueEnd < 0) break;\n"
       "    if (valueIs(start, 'toolCall')) counts.toolCalls += 1;\n"
       "    else if (valueIs(start, 'thinking')) counts.thinkingBlocks += 1;\n"
       "  }\n",
       "")],
     "the counting loops share one pass over the prefix rather than five"),
]

ORIGINAL = io.open(SERVER, encoding="utf-8", newline="").read()


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
for entry in MUTATIONS:
    title, edits, expect = entry
    for old, new in edits:
        hits = ORIGINAL.count(old)
        if hits != 1:
            raise SystemExit("FAIL  anchor for %r matched %d times" % (title, hits))
        if old == new:
            raise SystemExit("FAIL  empty mutation for %r: the anchor equals its replacement" % title)
    try:
        mutated = ORIGINAL
        for old, new in edits:
            mutated = mutated.replace(old, new, 1)
        if mutated == ORIGINAL:
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
        io.open(SERVER, "w", encoding="utf-8", newline="").write(ORIGINAL)

restored = io.open(SERVER, encoding="utf-8", newline="").read() == ORIGINAL
after_code, after = run()
after_ok = after_code == 0 and "0 failed" in after
print(("ok   " if restored else "FAIL ") + "server.mjs restored byte for byte")
print(("ok   " if after_ok else "FAIL ") + "green again after restore")

sys.exit(0 if (ok and all(caught) and restored and after_ok) else 1)