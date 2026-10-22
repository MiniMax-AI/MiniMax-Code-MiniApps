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
     "var hasDelta = !!(body && body.delta && state.payload && Array.isArray(state.payload.turns));",
     "var hasDelta = !!body.delta;"),
    # The three below are the numbering check. A tail cut from a numbering that has since moved
    # lands in the middle of the wrong turn and reports nothing — which is the whole reason the
    # delta names the record its cursor pointed at.
    ("the numbering the tail was cut from is never checked",
     "and it checks the numbering the tail was cut from before merging anything",
     "        if (hasDelta && !deltaMatchesNumbering(state.payload, body)) {",
     "        if (false) {"),
    ("a tail that names no record at the cursor is taken on trust",
     "the check is refused, not assumed, when the tail names no record at the cursor",
     "        if (!based || typeof based.index !== 'number' || based.index < 0) return false;",
     "        if (!based || typeof based.index !== 'number' || based.index < 0) return true;"),
    ("a cursor of zero is treated as a numbering that might have moved",
     "and a cursor of zero has nothing before it that could have moved",
     "        if (based.index === 0) return true;", "        if (based.index === 0) return false;"),
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
    # The set the tail is about, from the page's side. A record rewritten in place keeps its index
    # and its id, so nothing else in the protocol can see that the page's copy is not the
    # service's — the tail comes back empty and the page keeps the old text under the new body's
    # validator. The service's half of this is in SERVER_CASES, because it edits server.mjs; a
    # case that edits one file and sits in the other's list is a case whose anchor never resolves.
    ("a tail is asked for without saying which set the page holds",
     "a tail is asked for with the cursor and the set the page holds",
     "          + '&n=' + held.count\n", ""),
    ("the page treats every failure as a refusal about its copy",
     "a refusal about the page's copy is recognised as one, and only as one",
     "        return error.code === 'trajectory_version_mismatch'\n"
     "          || error.code === 'trajectory_fingerprint_required';\n",
     "        return Boolean(error);\n"),
    ("the page asks for the whole body for something that is not a refusal",
     "a tail the service will not answer leaves the page asking for the whole body",
     "            if (isStaleCopyRefusal(error)) {\n", "            if (false) {\n"),
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
    ("the server stops saying which record its cursor pointed at",
     "the tail names the record its cursor pointed at",
     "        basedOn = { index: since, id: record.id === undefined ? null : record.id };",
     "        basedOn = { index: since, id: null };"),
    ("the tail names the record at upTo rather than the one at the cursor",
     "and it is looked up at the cursor, not at the end of the payload",
     "      if (record && record.index === since) {",
     "      if (record && record.index === upTo) {"),
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

    # The set the tail is about. A record rewritten in place keeps its index and its id, so
    # nothing else in the protocol can see that the page's copy is not the service's: the tail
    # comes back empty, and the page keeps the old text under the new body's validator.
    ("a tail is answered to a page whose copy is not the one the service has",
     "a content-only rewrite at the cursor cannot be acknowledged without replacing the displayed record",
     "export function deltaRefusal(payload, count, askedFingerprint) {\n",
     "export function deltaRefusal(payload, count, askedFingerprint) {\n  if (payload) return null;\n"),
    ("the refusal is computed and then ignored",
     "the service refuses a tail whose set the page did not state, and says so",
     "      if (refusal) {\n", "      if (false) {\n"),
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
    lines = proc.stdout.splitlines()
    fired = []
    for line in lines:
        if line.startswith("FAIL "):
            fired.append(line[5:].strip())
    # Two facts, and they are not the same one.
    #
    # The exit code says whether the guard PASSED — and a guard that fails an assertion on purpose
    # exits non-zero, so a non-zero code is what a CATCH looks like. Reading it as "the probe
    # crashed" turns every catch into a crash, which is a control that reports nothing but crashes.
    #
    # Whether the probe REPORTED is the other fact. This guard prints its summary line whether it
    # passed or failed, and a probe that died before its reporting block printed neither the
    # summary nor any FAIL line. A run that produced no output contains no name, so a crash cannot
    # be read as a catch.
    #
    # The verdict is the name. The exit code only says whether the baseline was clean.
    reported = any("checks passed" in line for line in lines)
    return proc.returncode, reported, fired, proc.stdout + proc.stderr


def main():
    originals = {CLIENT: CLIENT.read_bytes(), SERVER: SERVER.read_bytes()}
    code, reported, fired, output = run_probe()
    if code != 0 or not reported or fired:
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
            code, reported, fired, _ = run_probe()
        finally:
            target.write_bytes(originals[target])

        # A probe that did not report died before it could name anything, and a run that produced
        # no output contains no name — so neither of those is a catch. A probe that reported and
        # named nothing failed nothing, which is a different thing: the rule still holds.
        if not reported:
            failures.append("%s: CRASHED — the probe did not report; that is not a catch" % name)
            continue
        if not fired:
            failures.append("%s: NOT CAUGHT — the probe reported and passed anyway" % name)
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
