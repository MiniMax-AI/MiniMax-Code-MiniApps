"""Break the session picker's visible set and its kind badge in the shipped source and require the
guards that own them to report each way it comes back by name.

The picker had one number behind it: the mtime of `messages.jsonl`. That number answers "when did
this session last write a message", and the picker needs to answer "is this session still in use" --
which is a different question, and the gap between them is invisible: a conversation the reader
opened and then read without writing to keeps its old mtime and ages out of the window while the
page is displaying it. The window's length was therefore decided by the reader's behaviour.

So the visible set now has three rules -- the current conversation is in it and first, the sessions
of its workspace come before the sessions of other workspaces, and each group keeps the recency
order -- and the mutations below are the ways back to the one number. Each one is a single edit,
and each is the way the defect would come back: a rule dropped, a rule moved, a rule inverted.

Two of them are the interesting ones. The first is the injection: the current conversation is
built from the path the runtime recorded for it, under the same containment check the 'latest'
resolver gives it, and a version that skips the containment check builds an entry from a path
outside the session store. The second is the read of the workspace column: a runtime database
written before that column existed has none, and a version that reads it without asking whether
it is there takes the whole list down with it.

The last two are the badge, and they are the same pair the branch marker had: applied to every
row, and applied to none. Both still contain the right characters, which is why the guards check
the rendered label rather than the string.

Two probes, because the rules live on two sides of the wire: the visible set is the service's,
and the badge is the page's. A mutation has to be caught by one of them, by name.

Anchors are multi-line and both shipped files are LF, so they are written with bare \\n and read
and written with newline='' -- matching on normalised text while preserving the file's own endings.
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
CLIENT = os.path.join(PLUGIN, "miniapp", "client", "index.html")
PROBES = [
    os.path.join(HERE, "verify-session-picker.mjs"),
    os.path.join(HERE, "client-check.mjs"),
]

# Each entry is (title, edits, expect) and optionally a fourth element naming the file to mutate,
# defaulting to the server.
MUTATIONS = [
    # The defect itself: the conversation the reader is in is not in the list at all. The visible
    # set falls back to the window, and the window is the thing that was wrong.
    ("the current conversation is not injected into the visible list",
     [("    currentEntry = built.entry;\n", "    currentEntry = null;\n")],
     "the current conversation is in the visible list even though its file is the oldest"),

    # Half of the rule: the conversation is in the list, but at the end of it. A reader who opens
    # the picker still finds it, twenty rows down, and the list no longer answers "which one am I
    # in" at a glance.
    ("the current conversation is appended at the end instead of the first",
     [("  const ordered = currentEntry ? [currentEntry, ...same, ...other] : [...same, ...other];",
       "  const ordered = currentEntry ? [...same, ...other, currentEntry] : [...same, ...other];")],
     "and the current conversation is first"),

    # The partition, dropped. Every session comes back in one group, which is the plain recency
    # order -- the order the picker had before the current conversation was pinned.
    ("the workspace partition is dropped",
     [("    if (currentWorkspace !== null && sameWorkspacePath(workspace, currentWorkspace)) same.push(entry);",
       "    if (currentWorkspace !== null && sameWorkspacePath(workspace, currentWorkspace)) other.push(entry);")],
     "the sessions of the current workspace come before the sessions of other workspaces"),

    # The partition kept, the order inside it inverted. The list still looks grouped, and each
    # group now answers "least recent first", which is a question nobody asked.
    ("the groups are ordered the other way round",
     [("  const byRecency = (a, b) => b.lastActiveAt - a.lastActiveAt;",
       "  const byRecency = (a, b) => a.lastActiveAt - b.lastActiveAt;")],
     "each group keeps the recency order"),

    # The no-database fallback. Without a runtime database there is no current conversation and
    # no current workspace, and the list is what the walk found -- in the walk's order.
    ("the list is reordered when there is no runtime database",
     [("    return entries.slice(0, limit);\n", "    return entries.slice().reverse().slice(0, limit);\n")],
     "without a runtime database the list is the plain recency order"),

    # The purpose column, read as if every runtime database had it. A database written before
    # that column existed does not have it, and this takes the whole read down with it -- which
    # is a list with no titles and no kinds at all, not a list with fewer of them.
    ("the purpose is read as if every database had the column",
     [("        purpose: typeof row.purpose === 'string' && row.purpose.trim() ? row.purpose.trim() : null,",
       "        purpose: row.purpose.trim(),")],
     "a database without the purpose column still reports the title and the kind of every session"),

    # The workspace column, the same way. It is the newest of the columns and the one that
    # orders the list, so a database without it is the case that has to degrade rather than fail.
    ("the workspace is read as if every database had the column",
     [("  if (!meta || typeof meta.workspace !== 'string' || !meta.workspace.trim()) return null;",
       "  if (!meta) return null;\n  return meta.workspace.trim();")],
     "a database without the workspace column still lists every session"),

    # The containment check. The recorded path is a database column rather than a name this app
    # chose, so it gets the same check a catalog file name gets -- and a version that skips it
    # builds an entry from a directory outside the session store.
    ("a recorded path that escapes the sessions root is used anyway",
     [("  if (dir !== root && !dir.startsWith(root + sep)) return { entry: null, rejected: true };",
       "  if (false) return { entry: null, rejected: true };")],
     "a recorded path that escapes the sessions root is refused"),

    # ---- the badge, on the page ----
    #
    # Applied to every row. The label still contains 轻量, so every check that asks "does the row
    # say 轻量" passes -- and every ordinary conversation now claims to be something it is not.

    ("the kind badge is applied to every session",
     [("        var tag = session ? sessionTagBadge(session.sessionTag) : '';",
       "        var tag = sessionTagBadge('lightweight');")],
     "the badge is driven by the field, not by where the row sits in the list",
     CLIENT),

    # Applied to none. The other direction, and the one that looks like a simplification: the
    # badge is a nicety, and a nicety can be dropped.
    ("the kind badge is never applied",
     [("        var tag = session ? sessionTagBadge(session.sessionTag) : '';",
       "        var tag = '';")],
     "a lightweight session is badged in the picker",
     CLIENT),
]

ORIGINALS = {
    SERVER: io.open(SERVER, encoding="utf-8", newline="").read(),
    CLIENT: io.open(CLIENT, encoding="utf-8", newline="").read(),
}


def run():
    code = 0
    chunks = []
    for probe in PROBES:
        proc = subprocess.run(["node", probe], cwd=HERE,
                              capture_output=True, text=True, encoding="utf-8", errors="replace")
        if code == 0:
            code = proc.returncode
        chunks.append(proc.stdout + proc.stderr)
    return code, "\n".join(chunks)


ok = True
code, baseline = run()
base_ok = code == 0 and "0 failed" in baseline
print(("ok   " if base_ok else "FAIL ") + "baseline green")
ok = ok and base_ok

caught = []
for entry in MUTATIONS:
    title, edits, expect = entry[0], entry[1], entry[2]
    target = entry[3] if len(entry) > 3 else SERVER
    original = ORIGINALS[target]
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
        io.open(target, "w", encoding="utf-8", newline="").write(mutated)
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
        io.open(target, "w", encoding="utf-8", newline="").write(original)

restored = all(io.open(path, encoding="utf-8", newline="").read() == text
               for path, text in ORIGINALS.items())
after_code, after = run()
after_ok = after_code == 0 and "0 failed" in after
print(("ok   " if restored else "FAIL ") + "both files restored byte for byte")
print(("ok   " if after_ok else "FAIL ") + "green again after restore")

sys.exit(0 if (ok and all(caught) and restored and after_ok) else 1)
