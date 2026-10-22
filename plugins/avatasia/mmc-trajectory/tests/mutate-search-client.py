"""Mutation control for the page's half of the search move.

The filter used to be `recordSearchText(record).indexOf(needle) >= 0` — a scan of five fields the
page happened to be holding. It is now a set of record indexes the server sent, and every mutation
here undoes one of the four things that move required and the page now owns:

  - asking a set at all, instead of scanning text;
  - telling 「no answer yet」 apart from 「matched nothing」;
  - letting only the newest request write, since the answer now arrives out of order;
  - re-asking when the payload changed, since the answer names indexes of the payload that was
    there before;
  - re-asking when the RECORDS changed but the shape did not, since the answer names a set of
    records and not only a set of indexes — a record rewritten in place keeps every counter;
  - keying a secondary read by the record's own version, so a retry after a reload cannot take
    the pending answer of the record that took its place.

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
        "        if (state.query && (changed || (state.searchSet && displayedRecordSet() !== state.searchSet))) {\n"
        "          runSearch(state.query);\n"
        "        }",
        "        if (state.query && (state.searchSet && displayedRecordSet() !== state.searchSet)) {\n"
        "          runSearch(state.query);\n"
        "        }",
    ),
    (
        "a content-only payload change does not retire the previous search answer",
        "        if (state.query && (changed || (state.searchSet && displayedRecordSet() !== state.searchSet))) {",
        "        if (state.query && changed) {",
    ),
    (
        "a read joins a newer record's pending read after reload, because the key does not carry the record's version",
        "        return sid + '#' + gen + '#' + (state.etag || '') + '#' + index + '#' + (version || '');",
        "        return sid + '#' + gen + '#' + (state.etag || '') + '#' + index;",
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
        "          + (generation === null ? '' : '&generation=' + encodeURIComponent(String(generation)))",
        "          + ''",
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
        "            state.searchError = null;\n            state.searchRefresh = 0;\n            resetWindowMode();",
        "            state.searchRefresh = 0;\n            resetWindowMode();",
    ),
    # ---- the search is about the body on screen ---------------------------------------
    #
    # The hits the server sends are INDEXES into one body's records, so they only mean
    # anything against that body. The search used to ask for `latest` -- "whichever session is
    # current now" -- and the runtime can make another conversation current while the page
    # still shows this one. The answer then described another conversation's records, and the
    # indexes filtered this body's rows against another body's matches: a row that matches
    # read as a miss and a row that does not read as a hit. The count alone never showed it.
    #
    # Three controls, because the promise has two halves and one of them has two names. The
    # request has to ask about the displayed session, and the ANSWER has to be checked against
    # it -- by id and by the slice -- before its indexes may filter that body. A control that
    # dropped both halves at once would leave the id half and the slice half never asked
    # whether they could fail.
    (
        "the search asks about the current session instead of the one on screen",
        "        var session = displayedSessionParam();",
        "        var session = sessionParam();",
    ),
    (
        "the search stops checking which session the answer is about",
        "            if (!answered || !displayed || answered.id !== displayed.id\n"
        "              || answeredSlice !== displayedSlice) {",
        "            if (!answered || !displayed\n"
        "              || answeredSlice !== displayedSlice) {",
    ),
    (
        "the search stops checking which slice of the session the answer is about",
        "            if (!answered || !displayed || answered.id !== displayed.id\n"
        "              || answeredSlice !== displayedSlice) {",
        "            if (!answered || !displayed || answered.id !== displayed.id) {",
    ),
    # ---- the slice is the one the BODY is, not the one the reader picked ---------------
    #
    # The reader's selection and the body on screen are two different things, and they come
    # apart when the load of a picked generation FAILS: the selection says one thing and the
    # body says another. Every read that asks the server about "a record inside this body" has
    # to ask about the BODY's own slice — the search, the raw read, the record read, and the
    # browser's own cache key. A request built from the selection asks about a body that is not
    # there, and the answer it gets back carries indexes of THAT body.
    (
        "the search asks about the generation the reader picked, not the slice on screen",
        "        var session = displayedSessionParam();\n        var generation = displayedGeneration();",
        "        var session = displayedSessionParam();\n        var generation = state.generation;",
    ),
    (
        "the raw read asks about the generation the reader picked, not the slice on screen",
        "        var url = '/api/trajectory/raw?index=' + encodeURIComponent(String(index))\n"
        "          + '&session=' + displayedSessionParam();\n"
        "        var generation = displayedGeneration();",
        "        var url = '/api/trajectory/raw?index=' + encodeURIComponent(String(index))\n"
        "          + '&session=' + displayedSessionParam();\n"
        "        var generation = state.generation;",
    ),
    (
        "the record read asks about the generation the reader picked, not the slice on screen",
        "        var url = '/api/trajectory/record?index=' + encodeURIComponent(String(index))\n"
        "          + '&session=' + displayedSessionParam();\n"
        "        var generation = displayedGeneration();",
        "        var url = '/api/trajectory/record?index=' + encodeURIComponent(String(index))\n"
        "          + '&session=' + displayedSessionParam();\n"
        "        var generation = state.generation;",
    ),
    (
        "the raw cache key names the generation the reader picked, not the slice on screen",
        "        var gen = displayedGeneration() === null ? 'all' : String(displayedGeneration());",
        "        var gen = state.generation === null ? 'all' : String(state.generation);",
    ),
    # ---- the version of the record a position names ------------------------------------
    #
    # The session and the slice say WHICH BODY an answer is about. They say nothing about
    # whether the record at a given index is still the same record: a transcript rewritten under
    # the page leaves the indexes alone and changes the records behind them. So the version is
    # checked before a hit may filter anything, and it travels with every read that names a
    # position.
    (
        "the search stops checking which version of the record a hit names",
        "              if (typeof shown.v === 'string' && shown.v !== '' && shown.v !== hit.v) {",
        "              if (false) {",
    ),
    (
        "the raw read stops naming the version of the record it asks for",
        "        // the retry is a different question wearing the same question's clothes.\n"
        "        if (version) url += '&v=' + encodeURIComponent(version);",
        "        // the retry is a different question wearing the same question's clothes.",
    ),
    (
        "the record read stops naming the version of the record it asks for",
        "        // The same record, the same way: the version travels with the request so the service can\n"
        "        // refuse when the position it would answer is a different record than the one opened — and\n"
        "        // it is the record's own version, so a retry after a reload asks about the same record.\n"
        "        if (version) url += '&v=' + encodeURIComponent(version);",
        "        // The same record, the same way: the version travels with the request so the service can\n"
        "        // refuse when the position it would answer is a different record than the one opened — and\n"
        "        // it is the record's own version, so a retry after a reload asks about the same record.",
    ),
    # ---- the version travels with the RECORD, not with the screen ------------------------
    #
    # A read that comes back 「this session is not cached」 reloads the body and asks again. The
    # body it reloads is a DIFFERENT one — the transcript moved while the tab was open — so a
    # version read off the screen at that moment belongs to the NEW body's record at that index,
    # and the retry is a different question wearing the same question's clothes. The service
    # answers it, because it is a perfectly good question about a perfectly good record: the
    # wrong one.
    #
    # So the version comes from the record the reader opened, and this control is the old way
    # round: the version of whatever is at that index NOW.
    (
        "a read takes the version of the record now on screen instead of the one the reader opened",
        "      function recordVersionOf(record) {\n"
        "        return record && typeof record.v === 'string' ? record.v : '';\n"
        "      }",
        "      function recordVersionOf(record) {\n"
        "        var flat = Array.isArray(state.flat) ? state.flat : [];\n"
        "        for (var i = 0; i < flat.length; i += 1) {\n"
        "          var entry = flat[i];\n"
        "          var shown = entry && entry.record ? entry.record : entry;\n"
        "          if (shown && shown.index === (record && record.index)) {\n"
        "            return typeof shown.v === 'string' ? shown.v : '';\n"
        "          }\n"
        "        }\n"
        "        return '';\n"
        "      }",
    ),
    # ---- the answer has to be about the SET the page is showing --------------------------
    #
    # A search answer says 「these records match and the rest do not」, and the part of it that
    # matters to the reader is the part it does NOT name: a record this body has and that body
    # does not match gets dimmed as if it did not contain the needle, with nothing saying so.
    #
    # So the request says which set it is about — how many records the page has, and a
    # fingerprint of their versions — and the service answers only if it searched THAT set.
    (
        "the search stops saying which set of records it is about",
        "          + '&n=' + versions.length\n"
        "          + '&fp=' + encodeURIComponent(recordSetFingerprint(versions));",
        "          + '';",
    ),
    (
        "the search says how many records it is about, but not which ones",
        "          + '&n=' + versions.length\n"
        "          + '&fp=' + encodeURIComponent(recordSetFingerprint(versions));",
        "          + '&n=' + versions.length;",
    ),
    (
        "a refusal from the service is treated as an ordinary failure instead of asking again",
        "            if (error && error.code === 'search_version_mismatch') {\n"
        "              searchAnswerDoesNotApply();\n"
        "              return;\n"
        "            }",
        "",
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
