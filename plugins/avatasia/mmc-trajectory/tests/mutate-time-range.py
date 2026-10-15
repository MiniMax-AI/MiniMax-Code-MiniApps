"""Mutation control for verify-time-range.mjs.

This guard was excluded from `run.mjs` for its entire life, and the first six mutations below are
the ones that were checked BY HAND against a throwaway copy of the package while it sat there — a
one-off result that nothing re-ran, so a later edit could pass everything else in this directory
while this file went unverified. It runs in the default suite now, so they run here too.

Each mutation reintroduces exactly one bug and must be caught BY NAME. The name matters more than
the red: the guard prints FAILED_NAMES as JSON, so an edit that trips some unrelated assertion does
not count as catching the rule it was aimed at.

The expected name is the assertion that OWNS the rule. A mutation here is not satisfied by the
suite going red.

The long family at the bottom is one dropped count per compared field, and the reason it is a family
rather than three hand-picked cases is written where it is built.
"""
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
HTML = ROOT / "miniapp" / "client" / "index.html"
GUARD = HERE / "verify-time-range.mjs"

# (label, expected assertion name, anchor, replacement)
MUTATIONS = [
    (
        "a bound is read as UTC, shifting it by this machine's distance from Greenwich",
        "parse across midnight",
        "        var wall = new Date(year, month - 1, day, hour, minute, second, 0);",
        "        var wall = new Date(raw + 'Z');",
    ),
    (
        "the session-start subtraction is dropped, so a bound becomes a wall clock",
        "parse at session start",
        "        return wall.getTime() - sessionStartMs;",
        "        return wall.getTime();",
    ),
    (
        "one comparison in recordInRange() is flipped, so the filter keeps the wrong rows",
        "a date range selects exactly the records inside that wall-clock window",
        "        if (isCount(from) && at < from) return false;",
        "        if (isCount(from) && at > from) return false;",
    ),
    (
        "clearFilters() no longer runs the base reset",
        "清除筛选 runs the base reset",
        "      function clearFilters() {\n        resetBaseFilters();",
        "      function clearFilters() {",
    ),
    (
        "resetBaseFilters() no longer drops the range, leaving a filter the reader cannot see",
        "清除筛选 also drops the range",
        "        dropOverviewSelection();\n        clearTimeRange();",
        "        dropOverviewSelection();",
    ),
    (
        "the query and the range are cleared in the wrong order, so the ledger renders once with neither",
        "清除筛选 also drops the range",
        "        state.query = '';\n        state.searchHits = null;",
        "        state.searchHits = null;",
    ),
    (
        "the re-derived stats drop steers, the field the server's shape carries and this copy lost",
        "whole-session steers",
        "          steers: 0,\n",
        "",
    ),
    (
        "applying a range no longer re-cuts the snapshot, so the open-ended range grows on its own",
        "applying a range re-cuts the snapshot",
        "          state.rangeCutoff = latestRecordIndex();\n        }\n        syncRangeButtons();",
        "          state.rangeCutoff = null;\n        }\n        syncRangeButtons();",
    ),
    # ---- the two counters that were being compared at zero ------------------------------------
    # Both of these survived an earlier version of this guard, and that is worth recording rather
    # than just fixing: the fixture was built WITHOUT a bare checkpoint turn, so both sides read 0,
    # so `0 === 0` passed with the page's `+= 1` deleted outright. The guard was comparing two
    # zeros that it had itself arranged — a self-fulfilling comparison, which is the failure mode a
    # mutation control exists to surface and a count of assertions cannot.
    (
        "the page stops counting compactions, which the fixture now makes non-zero",
        "whole-session compactions",
        "        else if (kind === 'compaction') stats.compactions += 1;",
        "",
    ),
    (
        "the page stops counting turns that are nothing but a checkpoint",
        "whole-session compactionTurns",
        "        stats.compactionTurns += 1;",
        "",
    ),
]

# ---- one dropped count per compared field ----------------------------------------------------
# The guard compares twenty numbers between the page's re-derivation and the server's own. Both
# sides are correct in a passing run, so a comparison is only capable of failing if one of them is
# broken — which means a field nobody mutates is a field whose comparison could be satisfied by a
# page that never counts it at all. Three fields had a mutation here; the other seventeen had none,
# and 「the page re-derives all twenty fields correctly」 was asserted by a guard that could not tell
# a page that re-derives nineteen of them.
#
# Driven off the same names the guard compares, with the label built from the field name for the
# same reason: a hand-written label and a hand-written expected name drift apart silently, and the
# control would then report a caught mutation that was caught by the wrong assertion.
N = "\n"
COUNT_ANCHORS = [
    ("messages", "            stats.messages += 1;\n"),
    ("toolCalls", N + "          else if (kind === 'toolCall') stats.toolCalls += 1;"),
    ("toolResults", N + "          else if (kind === 'toolResult') stats.toolResults += 1;"),
    ("thinkingBlocks", N + "          else if (kind === 'thinking') stats.thinkingBlocks += 1;"),
    ("steers", N + "          else if (kind === 'steer') stats.steers += 1;"),
    ("errors", "            stats.errors += 1;\n"),
    ("tokens.input", "            if (isCount(tokens.input)) stats.tokens.input += tokens.input;\n"),
    ("tokens.output", "            if (isCount(tokens.output)) stats.tokens.output += tokens.output;\n"),
    ("tokens.cacheRead", "            if (isCount(tokens.cacheRead)) stats.tokens.cacheRead += tokens.cacheRead;\n"),
    ("tokens.cacheWrite", "            if (isCount(tokens.cacheWrite)) stats.tokens.cacheWrite += tokens.cacheWrite;\n"),
    ("tokens.totalTokens", "            if (isCount(tokens.totalTokens)) stats.tokens.totalTokens += tokens.totalTokens;\n"),
    ("turnsWithPrompt", "            stats.turnsWithPrompt += 1;\n"),
    ("openTurns", "            if (turn.closed !== true) stats.openTurns += 1;\n"),
    ("qaTurns", "            if (turn.askedReader === true && turn.closed !== true) stats.qaTurns += 1;\n"),
    ("continuationTurns", "            stats.continuationTurns += 1;\n"),
    ("turnsWithoutPrompt", "            stats.turnsWithoutPrompt += 1;\n"),
]
for _field, _anchor in COUNT_ANCHORS:
    MUTATIONS.append(
        (
            "the page stops counting " + _field,
            "whole-session " + _field,
            _anchor,
            "",
        )
    )

# durationMs is not a count, so it gets a mutation of its own shape: the span of the rows kept is
# replaced by a constant. `0` is the value that says "this conversation took no time at all", which
# is what a reader would be shown if the subtraction went missing.
MUTATIONS.append(
    (
        "the page stops measuring the span of the rows it kept",
        "whole-session durationMs",
        "        stats.durationMs = first === null ? null : last - first;\n",
        "        stats.durationMs = first === null ? null : 0;\n",
    )
)

# `userMessages` cannot be deleted the way its neighbours are. It is the head of the
# `if / else if` chain over `record.kind`, so removing the line leaves an `else if` with nothing to
# attach to: the page stops parsing, the guard throws, and it prints no FAILED_NAMES at all. That is
# reported as UNNAMED, which is weaker than being reported as caught — the suite is red either way,
# but nothing says which rule was broken. Accumulating zero instead keeps the chain intact and
# produces the defect the field is compared on.
MUTATIONS.append(
    (
        "the page stops counting userMessages, the head of the record-kind chain",
        "whole-session userMessages",
        "          if (kind === 'user') stats.userMessages += 1;",
        "          if (kind === 'user') stats.userMessages += 0;",
    )
)

# The field the one above cannot be reached from. `messagesAll` is the only number on the card that
# must NOT be re-scoped — 「全程 N」 beside a range is the comparison the reader wants — so it is
# compared the other way round, against the server's own figure. In a fixture whose view was the
# whole conversation those two numbers were the same number, the assertion was the page agreeing
# with itself, and swapping the field for the view-scoped one changed nothing an assertion could
# see. That edit is this case.
MUTATIONS.append(
    (
        "the page re-scopes messagesAll onto the view, so 「全程 N」 quietly becomes the range's count",
        "messagesAll stays whole-session",
        "          messagesAll: base.messagesAll,\n",
        "          messagesAll: base.messages,\n",
    )
)

# ---- the fixture itself, so its own preconditions are known to be able to fail ----------------
# Everything above breaks the page and asks the guard to notice. These two break the guard's own
# session and ask the guard to notice that IT lost the property it depends on. Without them the
# twenty non-zero assertions are a claim about a generator nobody has tried to starve: shrink the
# session until a counter reads zero and every comparison below it becomes `0 === 0` again, with
# nothing in the suite able to say so.
#
# They target the guard rather than the page, so they are kept apart from MUTATIONS above: this file
# is the thing being run, and the two are restored by separate before/after byte snapshots.
FIXTURE_MUTATIONS = [
    (
        "the session stops generating checkpoint turns, so both compaction counters read zero",
        "the fixture makes compactions non-zero, so the page is counted against something",
        "    if (t % 23 === 7) {\n",
        "    if (t % 23 === 777) {\n",
    ),
    (
        "the view becomes the whole conversation again, so messagesAll and messages are one number",
        "the conversation and this view are different sizes, so the two cannot be swapped",
        "const FIRST_VIEWED_GENERATION = 1;",
        "const FIRST_VIEWED_GENERATION = 0;",
    ),
]


def read_exact(path):
    """Normalise to LF for matching, and report the file's own newline so it can be put back."""
    data = path.read_bytes()
    text = data.decode("utf-8").replace("\r\n", "\n")
    return text, ("\r\n" if b"\r\n" in data else "\n")


def write_exact(path, text, newline):
    if newline == "\r\n":
        text = text.replace("\n", "\r\n")
    path.write_bytes(text.encode("utf-8"))


def run_guard():
    proc = subprocess.run(
        ["node", str(GUARD)],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def failed_names(output):
    """The guard's machine-readable failure list, or None when it did not print one."""
    for line in output.splitlines():
        if line.startswith("FAILED_NAMES"):
            try:
                return json.loads(line.split("\t", 1)[1])
            except (IndexError, ValueError):
                return None
    return None


def run_cases(cases, path, original, missed, unnamed):
    """Apply each case to `path` in turn, restoring the file's startup bytes after every one.

    The restore is the bytes read before the first case rather than HEAD, so a run against a
    working tree holding uncommitted work in this file puts that work back rather than the
    committed version of it.
    """
    for label, expected, old, new in cases:
        text, newline = read_exact(path)
        if old not in text:
            print(f"SKIP  {label}: anchor not found")
            missed.append(label)
            continue
        if old == new:
            print(f"SKIP  {label}: the mutation changes nothing")
            missed.append(label)
            continue
        write_exact(path, text.replace(old, new, 1), newline)
        try:
            code, output = run_guard()
        finally:
            path.write_bytes(original)
        if code == 0:
            print(f"MISSED {label}: the guard still passed")
            missed.append(label)
            continue
        names = failed_names(output)
        if names is None:
            print(f"UNNAMED {label}: the guard failed without printing FAILED_NAMES")
            unnamed.append(label)
        elif expected in names:
            print(f"caught {label}\n         -> {expected}")
        else:
            print(f"MISSED {label}: guard failed, but not on {expected!r}\n         -> {names}")
            missed.append(label)


def main():
    code, output = run_guard()
    if code != 0:
        print("baseline guard does not pass; fix that first")
        print(output)
        return 1
    print("baseline clean")

    original = HTML.read_bytes()
    guard_original = GUARD.read_bytes()
    missed = []
    unnamed = []
    run_cases(MUTATIONS, HTML, original, missed, unnamed)
    if FIXTURE_MUTATIONS:
        run_cases(FIXTURE_MUTATIONS, GUARD, guard_original, missed, unnamed)

    # ---- the other direction ---------------------------------------------------------------
    # A note in the shipped file must not change a single verdict. If adding prose can turn this
    # guard red, it is reading the prose.
    text, newline = read_exact(HTML)
    anchor = "      function clearTimeRange() {"
    note = "/* note-only-edit-marker */"
    guard_bytes = GUARD.read_bytes()
    if anchor not in text or note in guard_bytes.decode("utf-8"):
        print("SKIP  comment-only edit: precondition not met")
        missed.append("comment-only edit")
    else:
        write_exact(HTML, text.replace(anchor, "      " + note + "\n" + anchor, 1), newline)
        try:
            code, output = run_guard()
        finally:
            HTML.write_bytes(original)
        if HTML.read_bytes() != original:
            print(f"NOT RESTORED {HTML}")
            return 1
        if code != 0:
            print(f"MISSED comment-only edit: adding a note turned the guard red\n{output}")
            missed.append("comment-only edit")
        else:
            print("caught a comment-only note leaves every verdict unchanged")

    if HTML.read_bytes() != original:
        print(f"NOT RESTORED {HTML}")
        return 1
    if GUARD.read_bytes() != guard_original:
        print(f"NOT RESTORED {GUARD}")
        return 1
    print("files restored byte-for-byte")

    if missed or unnamed:
        if missed:
            print(f"\n{len(missed)} mutation(s) got through")
        if unnamed:
            print(f"{len(unnamed)} mutation(s) failed without naming a rule")
        return 1
    print(f"\nall {len(MUTATIONS)} mutations caught, each by name")
    return 0


if __name__ == "__main__":
    sys.exit(main())
