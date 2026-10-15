"""Mutation control for the overview strip's filtering path.

Scope, stated up front so the next person does not read this as covering the guard: this
control covers **only** the strip's answer to 「may this record be drawn」. `verify-overview.mjs`
holds another hundred assertions — lane assignment, brushed ranges, turn totals, the axis
labels — and none of them are mutated here. A control that named itself after the whole guard
would be claiming coverage it does not have, which is the failure mode a mutation control is
supposed to prevent.

The one thing worth pinning here is the sentence already written above `spanPassesFilter()`:
it must not hold a predicate of its own. It did once — a copy of the whole decision that
drifted from the list's — and the copy drifted again the moment the search moved to the
server, because the copy still scanned text while the list was asking a set. The strip is now
a one-line adapter, and the only way to get a predicate back into it is to write a new one, so
that is what the first mutation writes.

The second mutation is a different shape and the more dangerous one, because it leaves the
predicate alone. A local flag in front of the call — 「only bother asking when something is
filtered」 — is an optimisation that costs nothing while the axes it lists agree with the
filter. They did not: the flag was `isFiltering()` with three of its five axes dropped, so a
time range or an 异常 rule alone left it false and the strip went on drawing every span the
list had already dropped. Reading to the reader that is 「筛选了但什么都没变」, which is
indistinguishable from a filter that is not wired up. The predicate was never wrong, so no
assertion about the predicate could have caught it — only running the render and holding the
strip against the list can.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
CLIENT = ROOT / "miniapp" / "client" / "index.html"
PROBE = HERE / "verify-overview.mjs"

SPAN_ADAPTER = """      function spanPassesFilter(record) {
        var owner = record ? turnById.get(record.turnId) : null;
        return recordVisible(record, owner || null, null);
      }"""

# The one call site inside the span loop, with its exact indentation — an anchor that does not
# carry its own leading whitespace would also match the predicate's other references.
STRIP_GATE = """          if (!spanPassesFilter(span.record)) continue;"""

COLUMN_COUNT = """        if (!lanes || typeof lanes.getBoundingClientRect !== 'function') return spanCount;
        var width = lanes.getBoundingClientRect().width;
        if (!(width > 0)) return spanCount;
        return Math.max(1, Math.round(width));"""

SPAN_AT = """        var lane = overviewLaneAt(clientX, clientY);
        if (lane < 0) return null;
        return nearestSpanAt(overviewTimeAt(overviewFractionAt(clientX)), lane);"""

# The last line of the same body, on its own. Two mutations need to sit on this function and they
# replace different things: one reinstates the whole body to move the RESOLUTION back to the DOM,
# the other leaves the resolution alone and changes only the RETURN. Sharing SPAN_AT between them
# would make the second one's replacement collide with the first one's anchor.
SPAN_AT_RETURN = "        return nearestSpanAt(overviewTimeAt(overviewFractionAt(clientX)), lane);"

# ---- the model's own reuse -----------------------------------------------------------------
# The two below do not touch what the model computes; they change whether it is computed again.
# That is the whole shape of this cache, and it is the shape a shape-only assertion cannot see: a
# stripped-down version that stores both inputs and then rebuilds anyway produces an identical
# model, so every value check still passes. Only counting the rebuilds tells them apart.
CACHE_HIT = """        if (overviewCache.flat === flat && overviewCache.axis === state.actualDuration) {
          return overviewCache.model;
        }"""

CACHE_HIT_ROWS_ONLY = "        if (overviewCache.flat === flat && overviewCache.axis === state.actualDuration) {"

MUTATIONS = [
    (
        "the model is rebuilt on every render, so the seven callers that change nothing pay for it",
        CACHE_HIT,
        """        if (false) {
          return overviewCache.model;
        }""",
        "the same rows again do not rebuild it",
    ),
    (
        "the model is keyed on the rows alone, so turning the duration axis keeps a model built on the other one",
        CACHE_HIT_ROWS_ONLY,
        "        if (overviewCache.flat === flat) {",
        "turning the duration axis on rebuilds",
    ),
    (
        "the strip keeps a predicate of its own instead of asking the list",
        SPAN_ADAPTER,
        """      function spanPassesFilter(record) {
        if (state.query && !(record && String(record.summary || '').indexOf(state.query) >= 0)) return false;
        if (state.kinds.indexOf(record.kind) < 0) return false;
        return true;
      }""",
    ),
    (
        "the strip is handed no turn, so a per-turn filter cannot reach it",
        SPAN_ADAPTER,
        """      function spanPassesFilter(record) {
        return recordVisible(record, null, null);
      }""",
    ),
    (
        "the strip asks the filter only when a local flag says something is filtered",
        STRIP_GATE,
        """          var filtering = state.query !== '' || state.kinds.length !== KIND_ORDER.length;
          if (filtering && !spanPassesFilter(span.record)) continue;""",
    ),
    # ---- one node per pixel column, not one per record -------------------------------------
    # The three above are about WHICH records belong on the strip. These four are about HOW it
    # draws the ones that do, which is where the 3,937 ms went: one node per record meant 36,525
    # nodes stacked ~42 deep on every pixel of an 872px strip.
    (
        "the strip draws one node for the whole axis, which is a solid block",
        COLUMN_COUNT,
        """        var width = lanes.getBoundingClientRect().width;
        if (!(width > 0)) return spanCount;
        return 1;""",
    ),
    (
        "the strip stops counting columns and is back to a node per record",
        COLUMN_COUNT,
        """        return spanCount;""",
    ),
    (
        "the selected record no longer gets a node of its own, so it loses its highlight",
        "        overviewAppendMarker(lanes, state.selectedId, 'data-current-marker', columns, view, model, fullDuration);",
        "        /* the selected record is left to whichever column it happens to own */",
    ),
    (
        "a hovered record that owns no column loses its highlight with it",
        "        if (!id || found) return;\n        var span = overviewSpansById.get(id);",
        "        if (!id || found) return;\n        if (true) return;\n        var span = overviewSpansById.get(id);",
    ),
    (
        # The one an acceptance review caught: hover resolved the record from the DOM, so after
        # aggregation — where only a column winner has a node — every other record became
        # unreachable, and the marker above could never fire for the case it was written for.
        # Reinstating the previous implementation verbatim is the honest shape of this mutation:
        # it is not a plausible typo, it is the code that shipped an hour earlier.
        "hover takes the record from the node under the pointer, so a record with no column cannot be hovered",
        SPAN_AT,
        """      function spanAt(clientX, clientY) {
        var node = document.elementFromPoint(clientX, clientY);
        while (node && node !== dom.overviewTrack) {
          if (node.classList && node.classList.contains('ov-span')) {
            var key = node.getAttribute('data-record-id');
            return key === null ? null : (overviewSpansById.get(key) || null);
          }
          node = node.parentNode;
        }
        return null;
      }""",
    ),
    (
        # The one a second acceptance review caught, and the reason this list needed a
        # behavioural check rather than another regex. Every earlier mutation here changes HOW the
        # hit test resolves; this one leaves the resolution exactly right — the model, the lane, the
        # nearest span — and changes only what it hands back, turning the span into its row key.
        # `client-check.mjs` reads that one as source text, and both of its rejection conditions are
        # written against spellings: no `getAttribute('data-record-id')`, no `.record.id`. This
        # passes both. `hit.id` and `hit.record.index` pass both. Enumerating them does not end.
        # The assertion that catches it runs the function and asks what came back, because every
        # key-returning shape answers a string and a span is not a string.
        "the hit test hands back the row key, which click and hover then cannot share",
        SPAN_AT_RETURN,
        """        var hit = nearestSpanAt(overviewTimeAt(overviewFractionAt(clientX)), lane);
        return hit ? recordKey(hit.record) : null;""",
    ),
    (
        # The one a third review round caught, and the reason the check above asserts identity and
        # not shape. This wrapper carries every field a shape check looks at and names the right
        # record, so "is it an object with `record` and `id`" answers yes and "is `record.id` g3"
        # answers yes — while the value on hand is a NEW object, not the span the hit test found.
        # Everything the page does next would work on a wrapper today, which is exactly why a guard
        # that only asks about the shape reports safety it has not checked.
        "the hit test hands back a wrapper shaped like the span instead of the span",
        SPAN_AT_RETURN,
        """        var hit = nearestSpanAt(overviewTimeAt(overviewFractionAt(clientX)), lane);
        return hit ? { id: hit.id, record: hit.record } : null;""",
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


def named_failure(output):
    """The first rule the probe named, or None when it failed without naming one.

    `check()` failures print as `FAIL  <name>`, so that prefix is what carries the name. A
    probe that dies on an exception names nothing, and a control that calls that 「caught」
    would be reporting a crash as if it were evidence.
    """
    hits = named_failures(output)
    return hits[0] if hits else None


def named_failures(output):
    """Every rule the probe named, in order."""
    return [
        line.strip()[len("FAIL"):].strip()
        for line in output.splitlines()
        if line.strip().startswith("FAIL")
    ]


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
    for entry in MUTATIONS:
        label, old, new = entry[0], entry[1], entry[2]
        # Optional fourth element: the assertion that OWNS the rule this mutation targets. A probe
        # that goes red on something else has not caught this bug, and reporting that as caught is
        # how a mutation control ends up proving nothing while counting.
        expect = entry[3] if len(entry) > 3 else None
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
        name = named_failure(output)
        if name is None:
            print(f"UNNAMED {label}: the probe failed without naming a rule")
            unnamed.append(label)
        elif expect is not None and expect not in named_failures(output):
            print(f"MISSED {label}: probe failed, but not on {expect!r}\n         -> {named_failures(output)}")
            missed.append(label)
        else:
            print(f"caught {label}\n         -> {name}")

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
