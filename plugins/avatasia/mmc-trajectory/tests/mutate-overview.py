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

MUTATIONS = [
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
    return next(
        (line.strip()[len("FAIL"):].strip() for line in output.splitlines()
         if line.strip().startswith("FAIL")),
        None,
    )


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
        name = named_failure(output)
        if name is None:
            print(f"UNNAMED {label}: the probe failed without naming a rule")
            unnamed.append(label)
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
