"""Mutation control for verify-time-range.mjs.

This guard was excluded from `run.mjs` for its entire life, and the six mutations below are the
ones that were checked BY HAND against a throwaway copy of the package while it sat there — a
one-off result that nothing re-ran, so a later edit could pass everything else in this directory
while this file went unverified. It runs in the default suite now, so they run here too.

Each mutation reintroduces exactly one bug and must be caught BY NAME. The name matters more than
the red: the guard prints FAILED_NAMES as JSON, so an edit that trips some unrelated assertion does
not count as catching the rule it was aimed at.

The expected name is the assertion that OWNS the rule. A mutation here is not satisfied by the
suite going red.
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


def main():
    code, output = run_guard()
    if code != 0:
        print("baseline guard does not pass; fix that first")
        print(output)
        return 1
    print("baseline clean")

    original = HTML.read_bytes()
    missed = []
    unnamed = []
    for label, expected, old, new in MUTATIONS:
        text, newline = read_exact(HTML)
        if old not in text:
            print(f"SKIP  {label}: anchor not found")
            missed.append(label)
            continue
        if old == new:
            print(f"SKIP  {label}: the mutation changes nothing")
            missed.append(label)
            continue
        write_exact(HTML, text.replace(old, new, 1), newline)
        try:
            code, output = run_guard()
        finally:
            HTML.write_bytes(original)
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
    print("file restored byte-for-byte")

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
