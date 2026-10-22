"""Break the session picker's visible set and its kind badge in the shipped source and require the
guards that own them to report each way it comes back by name.

The picker had one number behind it: the mtime of `messages.jsonl`. That number answers "when did
this session last write a message", and the picker needs to answer "is this session still in use" --
which is a different question, and the gap between them is invisible: a conversation the reader
opened and then read without writing to keeps its old mtime and ages out of the window while the
page is displaying it. The window's length was therefore decided by the reader's behaviour.

So the visible set now has three rules -- the conversation the runtime database reports as
current is in it and first, the sessions of its workspace come before the sessions of other
workspaces, and each group keeps the recency order -- and the mutations below are the ways back
to the one number. Each one is a single edit, and each is the way the defect would come back: a
rule dropped, a rule moved, a rule inverted.

Three of them are the interesting ones. The first is the injection: the current conversation is
built from the path the runtime recorded for it, under the same containment check the 'latest'
resolver gives it, and a version that skips the containment check builds an entry from a path
outside the session store. The second reads the workspace column: a runtime database written
before that column existed has none, and a version that reads it without asking whether it is
there takes the whole list down with it. The third is the identity of that path, and it has two
parts now: the directory name can sit inside the sessions root and still belong to a different
session, and so can the manifest the runtime wrote beside the transcript -- a directory whose
name says one session and whose manifest says another is the other session's directory, and a
version that does not check would list that other session twice and lose the conversation the
page is about.

Three more are on the page. The badge is applied to every row, the badge is applied to none,
and the badge is placed in front of the name -- the third of those still contains the right
characters in the right places, which is why the guards check the rendered label rather than
the string. The last one is the row the reader pinned by hand, which the page adds itself: it
belongs above the rows the service sent, and a version that appends it to the end still
selects it, still shows it, and still looks right -- as long as nobody counts the rows.

Two probes, because the rules live on two sides of the wire: the visible set is the service's,
and the badge and the pinned row are the page's. A mutation has to be caught by one of them, by
name.

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
    # The defect itself: the conversation the runtime database reports as current is not in the
    # list at all. The visible set falls back to the window, and the window is the thing that was
    # wrong.
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

    # The identity of the recorded path, in two parts now. The directory name is one of them:
    # a path that points at another session's directory is refused, and this is the check that
    # keeps one directory from being listed twice. The manifest is the other, and it is below.
    #
    # A name that does not decode is not a contradiction -- it says nothing at all -- so the
    # check is "the name has to be this session IF it names one", and the manifest decides the
    # rest.
    ("the recorded path is not checked against the session its directory name encodes",
     [("      if (claimed && claimed !== expectedSessionId) {",
       "      if (false) {")],
     "a recorded path whose directory name names another session is refused even when its manifest agrees"),

    ("the recorded path refuses a directory whose name does not decode",
     [("      if (claimed && claimed !== expectedSessionId) {",
       "      if (claimed !== expectedSessionId) {")],
     "a recorded path to a directory whose name does not decode is accepted when its manifest names the session"),

    # The other part: the manifest the runtime wrote beside the transcript. It is the authority
    # on which session a directory holds -- the service reads a session's identity from it -- so
    # a directory whose name says one session and whose manifest says another is the OTHER
    # session's directory, and accepting it puts the current conversation's id on somebody
    # else's messages.
    ("the recorded path is not checked against the session its manifest names",
     [("      if (identity.id !== expectedSessionId) {\n"
       "        return { entry: null, rejected: true };\n"
       "      }",
       "      // the manifest is not checked here")],
     "a recorded path whose manifest names another session is refused"),

    # The id travels with the entry. The recorded path is the ONLY way the current conversation can
    # be in the list at all when its directory is outside the window the picker draws from, so an
    # entry built from it that carries no id is a row the page cannot group, label or select. And
    # the entry is the only holder of the id: the directory's name does not decode, so the
    # manifest is the identity, and nothing else in the path says which session this is.
    #
    # This one is here, in the picker's control, because this is where the recorded path is
    # reachable: the visible set is built from the window of thirty, and a session outside it is
    # reached by its recorded path or not at all. It was in the layers' control before, where the
    # visible set is built from the WHOLE walk -- so the recorded path is only consulted there for
    # a directory the walk never reached, and the mutation changed nothing that any assertion
    # could see. A mutation that cannot fail is worse than one that survives: it reports a rule
    # nobody is checking.
    ("the entry built from a recorded path carries no id",
     [("        sessionId: identity.id,", "        sessionId: null,")],
     "the entry it builds carries the session id, not just the directory"),

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
    #
    # This one dies of an exception, and the guard has to say so BY THAT NAME. The rule it
    # breaks is "a database that lacks a column still lists every session", and the way it is
    # broken is by taking the read down with it -- so the name that has to appear is the one the
    # section reports when it could not answer, not the name of an assertion in it.
    ("the workspace is read as if every database had the column",
     [("  if (!meta || typeof meta.workspace !== 'string' || !meta.workspace.trim()) return null;",
       "  if (!meta) return null;\n  return meta.workspace.trim();")],
     "a database without the workspace column still lists every session; "
     "the section threw before it could answer"),

    # The containment check. The recorded path is a database column rather than a name this app
    # chose, so it gets the same check a catalog file name gets -- and a version that skips it
    # builds an entry from a directory outside the session store.
    ("a recorded path that escapes the sessions root is used anyway",
     [("  if (!isUnderDirectory(root, dir)) return { entry: null, rejected: true };",
       "  if (false) return { entry: null, rejected: true };")],
     "a recorded path that escapes the sessions root is refused"),

    # The badge, written only on the rows that have one. The descriptor comes out of a cache,
    # so a row that loses its database entry keeps the tag it was given last time, while the
    # validator -- which reads the same rows -- reports none. The body and the ETag then
    # disagree about the same row, and only the body reaches the page.
    ("the kind tag is only written on the rows that have one",
     [("          sessionTag: meta ? sessionTagFor(meta.kind, meta.purpose) : null,",
       "          sessionTag: meta ? sessionTagFor(meta.kind, meta.purpose) : (descriptor.sessionTag ?? null),")],
     "the kind tag is written on every row, not only on the rows that have one"),

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

    # The badge's place inside the label. The label carries no marker for the layer any more --
    # the run pick says which rows are runs by being the control they are in -- so the badge is
    # judged against the name alone. Moved to the front, the row still contains the right
    # characters in the right places -- every check that asks "does the row contain 轻量" passes --
    # and the row now reads as a category with a name attached to it.
    ("the kind badge is placed in front of the name",
     [("        if (!parts.label) return '未命名会话 ' + parts.tail + parts.tag;\n"
       "        return parts.label + ' ' + parts.tail + parts.tag;",
       "        if (!parts.label) return parts.tag + '未命名会话 ' + parts.tail;\n"
       "        return parts.tag + parts.label + ' ' + parts.tail;")],
     "the badge comes after the name, not in front of it",
     CLIENT),

    # The row the reader pinned by hand, which the page adds itself because the service did not
    # send it. Appended to the end it is still there, still selected, still readable -- and it
    # is no longer the first session row, which is the only promise that was made about it.
    ("the row the reader pinned is appended to the end of the list",
     [("            select.insertBefore(pinned, select.options[1] || null);",
       "            select.appendChild(pinned);")],
     "the row the reader pinned is the first session row, above the rows the service sent",
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
