"""Mutation control for verify-incremental.mjs.

Two files, so each case names which one it edits. server.mjs is CRLF and index.html is LF,
and both are read and written as bytes with only the mutated substring replaced, so a blanket
read_text/write_text round trip cannot rewrite either one's line endings.

A probe that stops before reporting is not a catch. Mutating server.mjs into something Node
cannot import produces exactly that, and treating it as a pass would let a syntax error stand
in for evidence.
"""
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
PROBE = HERE / "verify-incremental.mjs"
CLIENT = ROOT / "miniapp" / "client" / "index.html"
SERVER = ROOT / "miniapp" / "node" / "server.mjs"

CLIENT_CASES = [
    ("a cursor is asked for without the validator it belongs with",
     "the request carries the cursor and the validator under one condition",
     "          + (!manual && state.sinceFor === cacheKey && state.since > 0\n",
     "          + (state.since > 0\n"),
    ("a manual refresh keeps the cursor",
     "a manual refresh drops the cursor as well as the validator",
     "          state.etagFor = '';\n          state.since = 0;\n          state.sinceFor = '';\n",
     "          state.etagFor = '';\n"),
    ("a delta is merged onto whatever happens to be in state.payload",
     "the merge needs both the delta marker and a payload in hand",
     "var mergeable = body && body.delta && state.payload && Array.isArray(state.payload.turns);",
     "var mergeable = !!body.delta;"),
    ("a tail turn is appended instead of merged into the turn it belongs to",
     "mergeDelta at cursor 0 gives back every record exactly once",
     "          if (at[incoming.id] === undefined) {", "          if (true) {"),
    ("replaying a tail duplicates the records it already had",
     "replaying the same tail changes nothing",
     "          if (at[index] === undefined) {", "          if (true) {"),
    ("the merge keeps the turn fields it already had instead of the fresh ones",
     "the merge takes the closed flag from the tail, not from the copy it already had",
     "          if (Object.prototype.hasOwnProperty.call(incoming, key)) merged[key] = incoming[key];",
     "          if (Object.prototype.hasOwnProperty.call(existing, key)) merged[key] = existing[key];"),
    ("the next cursor is re-derived by walking the records instead of taking the server's",
     "the cursor after a delta is the server upTo, not a second walk",
     "state.since = mergeable ? body.delta.upTo : payloadCursor(payload);",
     "state.since = payloadCursor(payload);"),
]

SERVER_CASES = [
    ("a blank cursor is read as a cursor",
     "a blank cursor is not a cursor",
     "  if (raw === null || raw === undefined || String(raw).trim() === '') return null;",
     "  if (raw === null || raw === undefined) return null;"),
    ("a negative cursor is read as a cursor",
     "a negative cursor is not a cursor",
     "  if (!Number.isInteger(value) || value < 0) return null;",
     "  if (!Number.isInteger(value)) return null;"),
    ("a fractional cursor is read as a cursor",
     "a fractional cursor is not a cursor",
     "  if (!Number.isInteger(value) || value < 0) return null;",
     "  if (value < 0) return null;"),
    ("a turn that gained nothing is sent anyway",
     "a turn that gained no records is absent from the tail",
     "    if (fresh === 0) continue;", "    // every turn, gained or not"),
    ("a tail turn travels only its records and loses its identity",
     "the merge takes the closed flag from the tail, not from the copy it already had",
     "    tail.push({ ...turn, records: all.slice() });", "    tail.push({ records: all.slice() });"),
    ("stats are thinned down to one counter on the way out",
     "stats travel whole, because a tail cannot be added to an accumulator",
     "    stats: payload.stats,", "    stats: { messages: (payload.stats || {}).messages },"),
    ("a page that is ahead of the server gets an empty tail and no warning",
     "a cursor past the end produces no tail at all",
     "  if (since > upTo) return null;", "  if (false) return null;"),
    ("an empty payload produces a tail instead of nothing",
     "a payload with no turns produces no tail",
     "  if (turns.length === 0) return null;", "  if (false) return null;"),
    ("a request with no cursor is still answered with a marked tail",
     "the server cuts a tail only where it has just built the payload",
     "    const delta = since === null ? null : buildDeltaPayload(payload, since);",
     "    const delta = buildDeltaPayload(payload, since || 0);"),

    # ---- the cut moves back to record granularity ----
    # This is the reported defect. The count is what decides *whether* a turn travels, and
    # re-applying the filter to what travels undoes the whole point: the record that gained a
    # duration has an index below the cursor, so a filter puts it back out of the tail. Both of
    # these keep `delta.records` correct, which is why the count is asserted apart from the cut.
    ("the cut goes back to per record, so the rewritten record is not sent",
     "the tail carries the old record that just gained a duration",
     "    tail.push({ ...turn, records: all.slice() });",
     "    tail.push({ ...turn, records: all.filter((r) => typeof r.index === 'number' && r.index > since) });"),
    ("a whole turn ships and the count inherits the whole turn instead of the additions",
     "while still counting only what is new",
     "    records += fresh;", "    records += all.length;"),
]

# The page side. A delta replayed against a copy that already has a record must be allowed to
# CHANGE it, and `continue` is the line that stops it — the same line that used to keep a replay
# from doubling a turn. Both jobs cannot live in one line, and replacing by index does both.
CLIENT_CASES += [
    ("the page goes back to skipping a record it already has",
     "a record the page already had takes the incoming copy, not the stale one",
     "          } else {\n            records[at[index]] = added[i];\n          }\n",
     "          } else {\n            continue;\n          }\n"),
]


def run_probe():
    proc = subprocess.run(
        ["node", str(PROBE)], cwd=str(ROOT), capture_output=True, text=True,
        encoding="utf-8", errors="replace",
    )
    fired = []
    for line in proc.stdout.splitlines():
        if line.startswith("FAIL "):
            fired.append(line[5:].strip())
    # A crash is the probe failing to run, which the exit code says. It is *not* "no assertion
    # fired" — this guard prints its FAIL lines only when there are any, so a passing probe
    # prints none, and conflating the two turns every surviving mutation into a fake crash.
    return proc.returncode == 0, fired, proc.stdout + proc.stderr


def main():
    originals = {CLIENT: CLIENT.read_bytes(), SERVER: SERVER.read_bytes()}
    ok, fired, output = run_probe()
    if not ok or fired:
        print("baseline verify-incremental.mjs did not pass; refusing to run mutations")
        print(output)
        return 1

    cases = ([(n, e, CLIENT, o, w) for n, e, o, w in CLIENT_CASES]
             + [(n, e, SERVER, o, w) for n, e, o, w in SERVER_CASES])

    failures = []
    for name, expected, target, old, new in cases:
        text = originals[target].decode("utf-8")
        count = text.count(old)
        if count != 1:
            failures.append("%s: anchor matched %d times in %s, expected exactly 1"
                            % (name, count, target.name))
            continue

        target.write_bytes(text.replace(old, new, 1).encode("utf-8"))
        try:
            passed, fired, _ = run_probe()
        finally:
            target.write_bytes(originals[target])

        if not ok:
            failures.append("%s: CRASHED — the probe could not run; that is not a catch" % name)
            continue
        if not fired:
            failures.append("%s: NOT CAUGHT — probe still passed" % name)
            continue
        if expected not in fired:
            failures.append("%s: caught by %s, expected %r" % (name, fired, expected))
            continue
        print("  caught by %s: %s" % (expected, name))

    for target, original in originals.items():
        if target.read_bytes() != original:
            failures.append("%s was not restored byte-for-byte" % target.name)
        else:
            print("%s restored byte-for-byte" % target.name)

    if failures:
        print("\nFAILURES:")
        for line in failures:
            print(" - " + line)
        return 1

    print("\nOK  (%d mutations, each caught by the guard that owns the rule)" % len(cases))
    return 0


if __name__ == "__main__":
    sys.exit(main())
