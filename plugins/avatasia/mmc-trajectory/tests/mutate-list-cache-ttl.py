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
CLIENT = os.path.join(PLUGIN, "miniapp", "client", "index.html")
PROBE = os.path.join(HERE, "verify-list-cache.mjs")

# Each entry is (title, edits, expect) and optionally a fourth element naming the file to mutate,
# defaulting to the server. The fourth element exists because one rule of D45's lives in the page
# rather than in the service: whether a session picker prints a count it does not have is decided on
# the client, so a mutation that proves the rule can fail has to be made there. Both files are read
# once at startup and restored byte for byte in the same `finally` that already covered the server.
MUTATIONS = [
    # The defect verbatim: the cache is shorter than the interval that expires it, so it is never
    # hit. Not a slow cache — a cache that cannot be reached. Measured against the LIST's cadence
    # rather than the page's, which is the one that actually calls this route.
    ("the list TTL drops below the poll interval",
     [("const LIST_CACHE_TTL_MS = 3000;", "const LIST_CACHE_TTL_MS = 1000;")],
     "is at or above the list poll interval"),

    # The other direction, and the one a 304 depends on. If the descriptor cache expires sooner
    # than the walk that feeds the validator, the tag is built from facts newer than the entries
    # it stands for, and a stale descriptor can be pinned in place by a tag that says nothing
    # changed. Raising the walk's TTL is the cheapest way in, because it never trips the rule
    # above on its own.
    ("the descriptor cache expires sooner than the walk that feeds the validator",
     [("const SESSION_CACHE_TTL_MS = 5000;", "const SESSION_CACHE_TTL_MS = 2000;")],
     "is at or below SESSION_CACHE_TTL_MS"),

    # The list body cache is a third thing the poll built, and it holds serialized bytes this
    # time. Small next to the other two, which is exactly why it is the one that gets forgotten —
    # the parsed-row cache leaked here once for the same reason.
    ("dispose stops releasing the list body cache",
     [("    sessionsBody = { material: '', body: null };\n", "")],
     "dispose releases the list body cache"),

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
     [("    listCache = { at: 0, entries: null };\n"
       "    titleCache = { at: 0, key: '', map: new Map() };\n",
       "    listCache = { at: 0, entries: null };\n")],
     "dispose releases the title cache"),

    # ---- D45: a prefix count is not a count. ----
    #
    # The constant's own comment said the counters were for 「counts nobody treats as exact」, and the
    # page treated them as exact: a session with 23,642 messages was offered to the reader as
    # 「（3 分钟前 · 10 条）」, the count in the first 64 KB of its active file. These five are the
    # ways back, and each one restores a number that is untrue in a way the reader cannot detect.

    # The gate removed. This is the original defect: the peek is still bounded, so this is not a
    # performance question, it is a "10 条" with no hint of being 10-out-of-23642.
    ("a prefix count is sent as the session message count again",
     [("      messageCount: peekIsWhole ? peek.messages : null,",
       "      messageCount: peek.messages,")],
     "a prefix message count is not sent as the session message count"),

    # The same lie under the other field name. Half a fix is the outcome to fear most here: the
    # session picker shows the message count and the turn count comes from the same prefix, so
    # fixing only one leaves a reader-visible number that is still a prefix.
    ("the message count is gated but the turn count is not",
     [("      turnCount: peekIsWhole ? peek.turns : null,", "      turnCount: peek.turns,")],
     "a prefix turn count is not sent either"),

    # The flag that decides it, defaulted the other way. A read that threw has counted nothing, and
    # this turns 「I could not count it」 into 「there are none」 — the same untrue number, zero.
    ("a read that failed is reported as a count of zero",
     [("    let peekIsWhole = false;", "    let peekIsWhole = true;"),
      ("      messageCount: peekIsWhole ? peek.messages : null,",
       "      messageCount: peek.messages,"),
      ("      turnCount: peekIsWhole ? peek.turns : null,", "      turnCount: peek.turns,")],
     "a read that failed is not reported as a count of zero"),

    # The gate is asked the wrong question: `read` is the bytes actually filled in, and it equals the
    # file's size on every read that reached the end — so it cannot distinguish "the whole file fit in
    # the budget" from "we stopped early". Asking about size is what makes the gate mean anything.
    ("the gate asks how much was read rather than how big the file is",
     [("      peekIsWhole = !truncatedByCap(head.size, LIST_PEEK_BYTES);",
       "      peekIsWhole = head.read >= LIST_PEEK_BYTES;")],
     "the list asks whether its prefix was the whole file"),

    # The client half. Printing a dash for a number that does not exist renders the absence of a
    # number in the shape of a number, which is the same defect one layer down: 「— 条」 is still a
    # 条 count, just an impossible one.
    ("the session picker prints a placeholder instead of omitting the count",
     [("        var tail = isCount(count) ? '（' + when + ' · ' + formatInt(count) + ' 条）' : '（' + when + '）';",
       "        var tail = '（' + when + ' · ' + formatInt(count) + ' 条）';")],
     "the session picker omits the count segment instead of printing a placeholder",
     CLIENT),
]

ORIGINALS = {
    SERVER: io.open(SERVER, encoding="utf-8", newline="").read(),
    CLIENT: io.open(CLIENT, encoding="utf-8", newline="").read(),
}


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
