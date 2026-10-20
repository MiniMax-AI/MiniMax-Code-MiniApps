"""Make a nameable session unopenable again, in the shipped source, and require
verify-session-reachability.mjs to report each way back by name.

The defect was never "the list is too short". It was that one truncated array was both the
picker's data and the service's only handle on a session directory, so `?session=<id>` could
only ever resolve the 30 the picker already shows. Measured on a real store: 146 candidates,
30 exposed, 116 answering 404 to their own id — 200/200 inside the window, 404/24 outside it.

Every mutation here is the same mistake wearing a different hat: collapsing the two products
back into one, trusting a decoded name as if it were an identity, or letting a resource budget
answer a question it has no standing to answer.

The two that look like harmless simplifications are the dangerous ones. Dropping the manifest
re-check on the index hit is faster and passes every existing guard, because nothing else in
the suite has a directory whose name disagrees with its manifest — it just serves the wrong
conversation under an id the reader typed. And replacing the `session_scan_budget_exhausted`
branch with a plain 404 is a one-line change that turns "we stopped looking" back into "it does
not exist", which is the same lie the original slice told, just further from its cause.

Anchors are multi-line and the tree is LF, so they carry bare \\n and the files are read and
written with newline=''. No anchor may contain a line ending of its own.
"""
import io
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN = os.path.dirname(HERE)
SERVER = os.path.join(PLUGIN, "miniapp", "node", "server.mjs")
CLIENT = os.path.join(PLUGIN, "miniapp", "client", "index.html")
PROBE = os.path.join(HERE, "verify-session-reachability.mjs")

MUTATIONS = [
    # ---- the two products collapse back into one ----
    #
    # The original shape. Everything else in the suite still passes: the list is unchanged, the
    # trajectory route still finds every session in the window, and no assertion anywhere else
    # had a session outside it.
    #
    # The walk now hands out THREE products -- the thirty most recent sessions, the whole walk,
    # and the id index -- so "one truncated list again" is the whole walk truncated as well as the
    # index dropped. The second layer's pool is the whole walk, and the reachability fix's
    # product is the index: losing either one is the shape this mutation puts back.
    ("the walk returns one truncated list again",
     [("  return { recentEntries: entries.slice(0, MAX_SESSION_LIST), allEntries: entries, byDecodedId, truncated };",
       "  return { recentEntries: entries.slice(0, MAX_SESSION_LIST), allEntries: entries.slice(0, MAX_SESSION_LIST), byDecodedId: new Map(), truncated };")],
     "the id index is not the recent list", SERVER),

    ("the recent list is no longer capped",
     [("  return { recentEntries: entries.slice(0, MAX_SESSION_LIST), allEntries: entries, byDecodedId, truncated };",
       "  return { recentEntries: entries, allEntries: entries, byDecodedId, truncated };")],
     "the recent list is still capped at MAX_SESSION_LIST", SERVER),

    # ---- the index stops being built from the walk ----
    #
    # Correct-looking, and now the picker pays for the reachability fix: the index is derived
    # from the slice, so a session outside the window has no fast path again.
    ("the index is derived from the recent list instead of the walk",
     [("  for (const entry of entries) {\n    const id = decodeSessionIdFromDirName(basename(entry.dir));\n"
       "    // A name that does not decode is still a real session;",
       "  for (const entry of entries.slice(0, MAX_SESSION_LIST)) {\n    const id = decodeSessionIdFromDirName(basename(entry.dir));\n"
       "    // A name that does not decode is still a real session;")],
     "the id index is not the recent list", SERVER),

    ("the index is no longer built at all",
     [("  for (const entry of entries) {\n    const id = decodeSessionIdFromDirName(basename(entry.dir));\n"
       "    // A name that does not decode is still a real session;",
       "  for (const entry of entries) {\n    const id = null;\n"
       "    // A name that does not decode is still a real session;")],
     "the index is built from the decoded directory name", SERVER),

    # ---- duplicates silently resolved by directory order ----
    #
    # `Map.set` keeps the last writer. `readdir` order is not sorted and is not stable across
    # platforms, so this is a Map that answers differently on two machines with the same store.
    ("duplicate ids are collapsed by directory order",
     [("    const bucket = byDecodedId.get(id);\n    if (bucket) bucket.push(entry);\n    else byDecodedId.set(id, [entry]);",
       "    byDecodedId.set(id, [entry]);")],
     "duplicate ids are kept as a list rather than collapsed", SERVER),

    # ---- a decoded name promoted to an identity ----
    #
    # The fast path now serves whatever the directory is called, without asking the manifest.
    # Every other guard stays green: there is no fixture in this suite whose name and manifest
    # disagree, so the only way to see this is to ask for a session by an id that belongs to one
    # directory and be handed another.
    ("an index hit is served without checking the manifest",
     [("          if (candidateIdentity.id === requested) verified.push({ entry: candidate, identity: candidateIdentity });",
       "          verified.push({ entry: candidate, identity: candidateIdentity });")],
     "a directory whose manifest disagrees is not served under the requested id", SERVER),

    ("an index hit never reads the identity at all",
     [("          const candidateIdentity = await readSessionIdentity(candidate.dir);\n"
       "          if (candidateIdentity.id === requested) verified.push({ entry: candidate, identity: candidateIdentity });",
       "          const candidateIdentity = { id: requested, generations: [] };\n"
       "          verified.push({ entry: candidate, identity: candidateIdentity });")],
     "an index hit still reads the directory identity", SERVER),

    # ---- ambiguity resolved by taking the first ----
    #
    # Two directories claiming one id, and the service quietly picks one. The reader is told
    # they are looking at a conversation that is half of somebody else's.
    ("an ambiguous id is resolved by taking whichever came first",
     [("        if (verified.length === 1) picked = verified[0];",
       "        if (verified.length >= 1) picked = verified[0];")],
     "an ambiguous id is not resolved by directory order", SERVER),

    # ---- the budget answers a question it has no standing to answer ----
    #
    # Back to one answer for two different situations. "We stopped looking at 400" is not
    # "there is no such session", and only one of the two is true.
    ("an exhausted scan budget is reported as a missing session",
     [("          if (candidates.truncated) {\n"
       "            return {\n"
       "              ok: false, status: 404, code: 'session_scan_budget_exhausted',\n"
       "              message: '会话数量超出本次扫描预算，请重试或缩小会话目录范围',\n"
       "            };\n"
       "          }\n", "")],
     "the two answers are reachable from different conditions", SERVER),

    ("the two failures report the same code",
     [("ok: false, status: 404, code: 'session_scan_budget_exhausted',",
       "ok: false, status: 404, code: 'session_not_found',")],
     "the exhaustion path is a distinct answer from \"no such session\"", SERVER),

    ("the walk no longer records that it stopped early",
     [("    for (const name of names) {\n      if (entries.length >= MAX_SESSION_CANDIDATES) { truncated = true; return; }",
       "    for (const name of names) {\n      if (entries.length >= MAX_SESSION_CANDIDATES) return;")],
     "a walk that runs out of candidate budget reports itself as truncated", SERVER),

    # ---- the basename entry point ----
    #
    # A second way to name a session, and the only one that covers a directory whose name does
    # not decode at all.
    ("a full directory basename can no longer name a session",
     [("          if (candidateIdentity.id === requested || basename(candidate.dir) === requested) {",
       "          if (candidateIdentity.id === requested) {")],
     "a full directory basename can still name a session", SERVER),

    # ---- the picker starts paying for the fix ----
    #
    # Widening the picker is a UI decision that was explicitly not taken here. Taking it by
    # accident, inside a reachability fix, is how a 9x descriptor cost arrives unannounced.
    #
    # The picker's pool is now the whole walk rather than the thirty most recent sessions, so
    # this is the line that says so. It is the second layer's requirement: a sub-agent in a
    # thirty-row window would take a main session' place.
    ("the list route starts building from the id index",
     [("    const allEntries = candidates.allEntries;\n",
       "    const allEntries = [...candidates.byDecodedId.values()].flat();\n")],
     "the list route builds from the whole walk", SERVER),

    # The trajectory route keeps the thirty most recent sessions for its 'latest' branch, and it
    # must not start building from the index either: the index is a reachability fix, and the
    # trajectory route is the one that pays for a descriptor per candidate.
    ("the trajectory route starts building from the id index",
     [("    const entries = candidates.recentEntries;\n",
       "    const entries = [...candidates.byDecodedId.values()].flat();\n")],
     "the trajectory route keeps the recent list for the latest branch", SERVER),

    # ---- the page names a session it is not showing ----
    #
    # `sessionParam()` prefers `hostSessionId`, so this restores a page that renders
    # 「跟随最新（自动切换）」 above a conversation it is pinned to and will never leave.
    ("the page stops naming the session the host pinned it to",
     [("        sessionId: detectHostSessionId(),", "        sessionId: null,")],
     "the page seeds the pinned session from the host id", CLIENT),

    ("a pinned session outside the recent list renders as a blank select",
     [("        if (previous && previous !== 'latest') {\n          select.value = previous;\n"
       "          if (select.selectedIndex < 0) {",
       "        if (previous && previous !== 'latest') {\n          select.value = previous;\n          if (false) {")],
     "a pinned id missing from the options gets one inserted, not a blank select", CLIENT),
]

ORIGINALS = {p: io.open(p, encoding="utf-8", newline="").read() for p in (SERVER, CLIENT)}


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
for title, edits, expect, target in MUTATIONS:
    paths = sorted({t for _, _, _, t in [(e[0], e[1], expect, target) for e in edits]})
    try:
        for old, new in edits:
            hits = ORIGINALS[target].count(old)
            if hits != 1:
                raise SystemExit("FAIL  anchor for %r matched %d times in %s" % (title, hits, target))
            if old == new:
                raise SystemExit("FAIL  empty mutation for %r: the anchor equals its replacement" % title)
        mutated = {p: ORIGINALS[p] for p in ORIGINALS}
        for old, new in edits:
            mutated[target] = mutated[target].replace(old, new, 1)
        if mutated[target] == ORIGINALS[target]:
            raise SystemExit("FAIL  mutation for %r changed nothing" % title)
        for p, text in mutated.items():
            io.open(p, "w", encoding="utf-8", newline="").write(text)
        during_code, during = run()
        named = expect in during
        red = during_code != 0
        print(("ok   " if (named and red) else "FAIL ") + "guard catches: " + title)
        if not named:
            print("       no assertion reported %r" % expect)
            for line in during.splitlines()[-4:]:
                print("       " + line.strip())
        elif not red:
            print("       the rule was reported but the guard still exited 0")
        caught.append(named and red)
    finally:
        for p, text in ORIGINALS.items():
            io.open(p, "w", encoding="utf-8", newline="").write(text)

restored = all(io.open(p, encoding="utf-8", newline="").read() == ORIGINALS[p] for p in ORIGINALS)
after_code, after = run()
after_ok = after_code == 0 and "0 failed" in after
print(("ok   " if restored else "FAIL ") + "shipped files restored byte for byte")
print(("ok   " if after_ok else "FAIL ") + "green again after restore")

sys.exit(0 if (ok and all(caught) and restored and after_ok) else 1)