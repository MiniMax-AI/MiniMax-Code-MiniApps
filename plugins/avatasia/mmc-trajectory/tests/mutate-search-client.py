"""Mutation control for the page's half of the search move.

The filter used to be `recordSearchText(record).indexOf(needle) >= 0` — a scan of five fields the
page happened to be holding. It is now a set of record indexes the server sent, and every mutation
here undoes one of the four things that move required and the page now owns:

  - asking a set at all, instead of scanning text;
  - telling 「no answer yet」 apart from 「matched nothing」;
  - letting only the newest request write, since the answer now arrives out of order;
  - re-asking when the payload changed, since the answer names indexes of the payload that was
    there before.

Each is a change the page renders differently and none of them throws.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
CLIENT = ROOT / "miniapp" / "client" / "index.html"
PROBE = HERE / "client-check.mjs"

MUTATIONS = [
    (
        "the filter scans the record's own text again, ignoring the server's answer",
        "        if (hitSet === null || hitSet === undefined) return true;\n        return !!(record && hitSet.has(record.index));",
        "        if (hitSet === null || hitSet === undefined) return true;\n        return String((record && record.summary) || '').toLowerCase().indexOf(String(needle).toLowerCase()) >= 0;",
    ),
    (
        "an unanswered search is rendered as matched nothing, so the table empties while it loads",
        "        if (hitSet === null || hitSet === undefined) return true;",
        "        if (hitSet === null || hitSet === undefined) return false;",
    ),
    (
        "no answer in force is turned into an empty set, so it reads as 「matched nothing」",
        "        if (!Array.isArray(hits)) return null;",
        "        if (!Array.isArray(hits)) return new Set();",
    ),
    (
        "a hit with no usable index is filed under a key that matches every record",
        "          if (Number.isInteger(index)) set.add(index);",
        "          set.add(Number.isInteger(index) ? index : NaN);",
    ),
    (
        "a late answer is allowed to overwrite a newer one",
        "            if (seq !== searchSeq) return;\n            searchController = null;",
        "            searchController = null;",
    ),
    (
        "a search in flight is not aborted, so every keystroke's request still runs to the end",
        "        if (searchController) searchController.abort();",
        "",
    ),
    (
        "a changed payload keeps the old hit set, so the new table is filtered by the old answer",
        "        if (changed && state.query) runSearch(state.query);",
        "",
    ),
    (
        "clearing the filters leaves the hit set behind, so the next query filters by a stale answer",
        "        state.searchHits = null;\n        state.searchPending = false;\n        state.searchTotal = 0;\n        state.searchTruncated = false;\n        state.searchError = null;\n        dropOverviewSelection();",
        "        dropOverviewSelection();",
    ),
    (
        "the count line cannot tell 「searching」 from 「searched and found none」",
        "        if (searchState.searchHits !== null && searchState.searchTotal === 0) return '未找到';",
        "        if (searchState.searchHits !== null) return '命中 ' + formatInt(searchState.searchTotal) + ' 条';",
    ),
    (
        "a search that failed is rendered as an empty table, which reads as an answer",
        "        if (searchState.searchError) return '搜索失败，以下为上次结果';",
        "",
    ),
    (
        "the needle is sent without the generation, so a slice search answers about the whole lineage",
        "          + (state.generation === null ? '' : '&generation=' + encodeURIComponent(String(state.generation)));",
        "          + '';",
    ),
    (
        "the hit set is built from the summaries rather than the indexes, so it can never match a row",
        "          var index = entry && typeof entry.index === 'number' ? entry.index : NaN;",
        "          var index = entry && typeof entry.summary === 'string' ? entry.summary.length : NaN;",
    ),
    # The one an acceptance review caught, and the reason the mutation list above is not the end of
    # the story. Every entry there changes what the page COMPUTES. This one changes what it REMEMBERS
    # about a request that already finished — and every existing check was blind to it from the same
    # side: the `searchStatusLabel` cases each construct their own state, and a state cannot be stale,
    # because it was written for the case it is asked about. The `runSearch` checks were source
    # regexes, and the line being removed is a line they were not written against.
    #
    # So nothing cleared `searchError` except typing and pressing the clear button — the two a reader
    # drives. A poll that re-runs the current query after the transcript changed is not a reader, so
    # a search that had failed once said 「搜索失败，以下为上次结果」 for the rest of the session, and
    # because the label reads the error before the counts, the stale error outranked the fresh hit set
    # it was describing. The page showed the right rows under the wrong sentence.
    (
        "an answer that arrives leaves the failure that preceded it standing",
        "            state.searchError = null;\n            resetWindowMode();",
        "            resetWindowMode();",
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


def run_probe():
    proc = subprocess.run(
        ["node", str(PROBE)],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def main():
    code, output = run_probe()
    if code != 0:
        print("baseline probe does not pass; fix that first")
        print(output)
        return 1
    print("baseline clean")

    original = CLIENT.read_bytes()
    missed = []
    unnamed = []
    for label, old, new in MUTATIONS:
        text, newline = read_exact(CLIENT)
        if old not in text:
            print(f"SKIP  {label}: anchor not found")
            missed.append(label)
            continue
        if old == new:
            print(f"SKIP  {label}: the mutation changes nothing")
            missed.append(label)
            continue
        write_exact(CLIENT, text.replace(old, new, 1), newline)
        try:
            code, output = run_probe()
        finally:
            CLIENT.write_bytes(original)
        if code == 0:
            print(f"MISSED {label}: the probe still passed")
            missed.append(label)
            continue
        first = next((line.strip() for line in output.splitlines() if line.strip().startswith("- ")), None)
        if first is None:
            print(f"UNNAMED {label}: the probe failed without naming a rule")
            unnamed.append(label)
        else:
            print(f"caught {label}\n         -> {first}")

    if CLIENT.read_bytes() != original:
        print(f"NOT RESTORED {CLIENT}")
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
