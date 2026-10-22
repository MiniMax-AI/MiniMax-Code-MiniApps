"""Mutation control for verify-search-segments.mjs.

Each mutation reintroduces exactly one bug the probe is supposed to catch. The probe must FAIL every
time, by NAME — a crash with no rule named is a weaker outcome, and this project treats it as one —
and the file must come back byte-for-byte identical afterwards.

The first six are the ones that matter: together they are the ways a segment can quietly stop being
"the text the page was searching". A dropped field, a reordered field, a different separator, no
folding and no whitespace rule each narrow what a reader can find, and none of them throws.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
MODULE = ROOT / "miniapp" / "node" / "search-segments.mjs"
PROBE = HERE / "verify-search-segments.mjs"

FIELDS = "export const SEARCH_FIELDS = ['summary', 'text', 'result', 'thinking', 'toolName'];"

MUTATIONS = [
    # ---- the surface has to be what the page searched -------------------------------------
    (
        "the thinking field is dropped from the search surface",
        FIELDS,
        "export const SEARCH_FIELDS = ['summary', 'text', 'result', 'toolName'];",
    ),
    (
        "the fields are read in a different order",
        FIELDS,
        "export const SEARCH_FIELDS = ['summary', 'result', 'text', 'thinking', 'toolName'];",
    ),
    (
        "the fields are joined with nothing instead of a separator",
        "  return normaliseWhitespace(parts.join('\\n')).toLowerCase();",
        "  return normaliseWhitespace(parts.join('')).toLowerCase();",
    ),
    (
        "whitespace is not normalised, so the surface is five lines per record again",
        "  return String(value).replace(/\\s+/g, ' ').trim();",
        "  return String(value);",
    ),
    (
        "the surface is not folded, so an upper-case needle finds nothing",
        "  return normaliseWhitespace(parts.join('\\n')).toLowerCase();",
        "  return normaliseWhitespace(parts.join('\\n'));",
    ),
    (
        "the needle is folded but not normalised, so what the reader typed decides the answer",
        "  return normaliseWhitespace(typeof needle === 'string' ? needle : '').toLowerCase();",
        "  return (typeof needle === 'string' ? needle : '').toLowerCase();",
    ),
    # ---- the boundary, and the ordinal it is only correct because of ----------------------
    (
        "the scan joins every line into one blob, so a needle can cross a record boundary",
        "  const hits = [];\n  let start = 0;\n  let ordinal = 0;",
        "  const hits = [];\n  const flat = surface.replace(/\\n/g, ' ');\n  if (flat.includes(needle)) hits.push(0);\n  let start = 0;\n  let ordinal = 0;",
    ),
    (
        # Was about empty lines in a plain surface, which the new format cannot produce: every
        # record's line starts with its answer, so an empty line means a record that is not there.
        # The hazard that replaced it is the prefix itself — a scan that tested the whole line would
        # answer from a record's KIND and SUMMARY rather than from the text being searched.
        "the scan tests the record's answer as well as its text",
        "    if (tab >= 0 && line.slice(tab + 1).includes(needle)) hits.push(ordinal);",
        "    if (tab >= 0 && line.includes(needle)) hits.push(ordinal);",
    ),
    (
        "the locators are numbered from one while the scan numbers from zero",
        "      ordinal: i,",
        "      ordinal: i + 1,",
    ),
    (
        "a locator of a record with no position claims file 0",
        "      fileIdx: typeof record.fileIdx === 'number' ? record.fileIdx : -1,",
        "      fileIdx: typeof record.fileIdx === 'number' ? record.fileIdx : 0,",
    ),
    # ---- the artifact ---------------------------------------------------------------------
    (
        "the manifest is published before the surface it describes",
        "      await rename(`${join(dir, 'surface.txt')}.tmp`, join(dir, 'surface.txt'));",
        "      await rename(`${join(dir, 'manifest.json')}.tmp`, join(dir, 'manifest.json'));",
    ),
    (
        "a manifest from another schema version is served anyway",
        "    if (manifest.schemaVersion !== SEGMENT_SCHEMA_VERSION) return null;",
        "",
    ),
    (
        "a surface with a line the manifest does not count is accepted",
        "  if (lines !== manifest.recordCount) return null;",
        "",
    ),
    (
        "the runtime's own revision stops being compared, so a rewrite that kept the length is reused",
        "    if (typeof a.revision === 'string' && a.revision.length > 0\n      && typeof b.revision === 'string' && b.revision.length > 0 && a.revision !== b.revision) {\n      return false;\n    }\n",
        "",
    ),
    (
        # The one that was still wrong after the revision comparison was fixed: the ACTIVE file has
        # no catalog entry, so it has no revision to compare, and a transcript rewritten in place
        # keeps its length — so "ALPHA BODY" became "BRAVO BODY" and every comparison in the file
        # said the same file. The mtime is the other half of this process's idea of a file's
        # identity (the parsed-rows cache and the trajectory entry both key on (size, mtime)), so
        # leaving it out is what let a segment built from the old bytes answer for the new ones.
        "the mtime stops being compared, so a rewrite that kept the length is reused",
        "    if (a.mtimeMs !== b.mtimeMs) return false;\n",
        "",
    ),
    (
        # The versions are read out of the lines by hand, so that a search over a big segment does
        # not parse every line it does not need. A hand-reading is a second way to answer 「which
        # version is this record」, and the two have to agree — the service folds them into the
        # fingerprint that says whether an answer is about the body the page is showing.
        "the versions of a segment's records are read as something else",
        "    if (tab >= 0 && tab <= end) out.push(versionInAnswer(surface.slice(start, tab)));",
        "    if (tab >= 0 && tab <= end) out.push(String(out.length));",
    ),
    (
        # The ledger position of a record is what puts the records back where the body has them:
        # the turn a record is in, and the record's own number in the body. The segments are one
        # file per generation and the body is not in file order, so a fold over the files is a
        # fold over a different set — and the answer is refused for a body that did not change.
        # Reading the line's ordinal instead of the record's number makes the position say where
        # the record sits IN THIS FILE, which is the order the wrong one.
        "the record's own number is read as the line's ordinal, so the records cannot be put back in order",
        "        index: numberInAnswer(answer, '\"index\":'),",
        "        index: numberInAnswer(answer, '\"ordinal\":'),",
    ),
    (
        # The turn a record is in is the other half of the position. Read as the record's own
        # number, the two halves of the position become one, and the turns of the body are gone.
        "the turn a record is in is read as its own number, so the ledger's order cannot be rebuilt",
        "        turnIndex: numberInAnswer(answer, '\"turnIndex\":'),",
        "        turnIndex: numberInAnswer(answer, '\"index\":'),",
    ),
    (
        # The manifest has to say how many of the body's records the segments do NOT cover. A
        # manifest that does not say cannot be told apart from one that says 「none」, and a set that
        # covers part of the body is not the set the page is holding — so a reader that takes such a
        # manifest for a complete one answers about a set nobody can name.
        "a manifest that does not say what it does not cover is served anyway",
        "      if (!Number.isInteger(manifest.uncovered) || manifest.uncovered < 0) return null;\n",
        "",
    ),
    (
        # The count itself: a record whose locator names no file in the table — and a record with no
        # locator at all — belongs to no generation's segment, so no segment holds it. Counted as
        # covered, the manifest says the set stands for the whole body, and the reader answers from
        # a set that is one record short.
        "the records no segment covers are counted as covered",
        "    if (typeof row.fileIdx !== 'number' || !Number.isFinite(row.fileIdx) || row.fileIdx < 0) {\n      uncovered += 1;\n    }",
        "    if (false) {\n      uncovered += 1;\n    }",
    ),
    # ---- the rest of the contract ---------------------------------------------------------
    (
        "the needle floor is dropped, so one character is a search",
        "  return foldNeedle(needle).trim().length >= MIN_NEEDLE_CHARS;",
        "  return foldNeedle(needle).length >= 0;",
    ),
    (
        "the hit cap is dropped, so a two-character needle returns the whole ledger",
        "  return { ordinals: hits.slice(0, limit), total: hits.length, truncated: true };",
        "  return { ordinals: hits, total: hits.length, truncated: true };",
    ),
    (
        "the active generation's segment is stored under a sealed generation's key",
        "  return generation === null || generation === undefined ? 'active' : `g${generation}`;",
        "  return generation === null || generation === undefined ? 'g0' : `g${generation}`;",
    ),
    # ---- a generation read short must not look like one read whole --------------------------
    (
        # The summary a search hit answers with is written onto the segment line, so this is where
        # a search can start reporting the kind of a record instead of what it says.
        "the segment line reports the kind where the summary belongs",
        "      summary: typeof record.summary === 'string' ? record.summary : '',",
        "      summary: typeof record.kind === 'string' ? record.kind : '',",
    ),
    (
        # `size` is the whole file whether or not the read covered it, so this comparison is the
        # only thing standing between a segment covering a PREFIX and being served as if it covered
        # everything. Remove it and a truncated generation answers with a smaller total and says
        # nothing about being wrong.
        "a source that was read short is trusted as if it had been read whole",
        "    if ((a.truncated === true) !== (b.truncated === true)) return false;\n    if (typeof a.revision === 'string' && a.revision.length > 0",
        "    if (typeof a.revision === 'string' && a.revision.length > 0",
    ),
    # ---- the answer is read back in ONE walk -----------------------------------------------
    (
        # The one that matters most here, because it is the version that was actually written and
        # then measured to be SLOWER than the 34.2 MB index read it replaced. It changes no answer:
        # every hit still names the right record and every assertion about values still passes. The
        # only symptom is that a needle matching 14,092 records walks the segment 14,092 times — so
        # the guard counts the walk instead of checking the answers.
        "the answers are read by walking the segment once per ordinal again",
        "  return ordinals.map((ordinal) => found.get(ordinal) ?? null);",
        "  return ordinals.map((ordinal) => {\n"
        "    let from = 0;\n"
        "    let line = 0;\n"
        "    while (from <= surface.length) {\n"
        "      const nl = surface.indexOf('\\n', from);\n"
        "      if (line === ordinal) {\n"
        "        const tab = surface.indexOf('\\t', from);\n"
        "        return tab < 0 ? null : JSON.parse(surface.slice(from, tab));\n"
        "      }\n"
        "      if (nl === -1) break;\n"
        "      from = nl + 1;\n"
        "      line += 1;\n"
        "    }\n"
        "    return found.get(ordinal) ?? null;\n"
        "  });",
    ),
    (
        # The batch is a batch because the scan hands back every ordinal at once. Answering in the
        # order they sit in the segment looks identical until the caller asks for a capped, sorted or
        # otherwise reordered subset — and then every hit names a different record.
        "the answers come back in the order they sit rather than the order asked",
        "  return ordinals.map((ordinal) => found.get(ordinal) ?? null);",
        "  return [...found.values()];",
    ),
    (
        # Structural, and the reason the first one is worth a mutation at all: a per-ordinal reader
        # could be reintroduced beside the batch one, break nothing above, and sit there waiting to be
        # called — which is how the O(n²) version got shipped in the first place.
        "a per-ordinal reader is exported again for a caller to reach for",
        "export function generationKey(generation) {\n  return generation === null || generation === undefined ? 'active' : `g${generation}`;\n}",
        "export function generationKey(generation) {\n  return generation === null || generation === undefined ? 'active' : `g${generation}`;\n}\n\n"
        "/** @deprecated one ordinal at a time — walks the whole segment to find it. */\n"
        "export function readSegmentHit(surface, ordinal) {\n  return readSegmentHits(surface, [ordinal])[0] ?? null;\n}",
    ),
    # ---- a retired field must not come back through this door ---------------------------
    (
        # The pair of fields this module stopped writing at schema 3. Nothing read them back, they
        # cost 4.36% of every segment surface, and retiring them was its own batch — so the one
        # thing worth guarding is that they stay gone. `buildSegment` writes whatever a record is
        # handed, which means stopping is not a decision this function makes on its own: any
        # upstream that starts supplying a byte range again puts it straight back on every line.
        # `mutate-file-index-rows.py` closes the other door — the projection — and a control that
        # owned only one of them could be walked around through the other.
        "the byte range rides along on every segment line again",
        "      fileIdx: typeof record.fileIdx === 'number' ? record.fileIdx : -1,\n    }) + '\\t' + searchSurfaceOf(record));",
        "      fileIdx: typeof record.fileIdx === 'number' ? record.fileIdx : -1,\n"
        "      byteStart: typeof record.byteStart === 'number' ? record.byteStart : -1,\n"
        "      byteEnd: typeof record.byteEnd === 'number' ? record.byteEnd : -1,\n"
        "    }) + '\\t' + searchSurfaceOf(record));",
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

    original = MODULE.read_bytes()
    missed = []
    unnamed = []
    for label, old, new in MUTATIONS:
        text, newline = read_exact(MODULE)
        if old not in text:
            print(f"SKIP  {label}: anchor not found")
            missed.append(label)
            continue
        if old == new:
            print(f"SKIP  {label}: the mutation changes nothing")
            missed.append(label)
            continue
        write_exact(MODULE, text.replace(old, new, 1), newline)
        try:
            code, output = run_probe()
        finally:
            MODULE.write_bytes(original)
        if code == 0:
            print(f"MISSED {label}: the probe still passed")
            missed.append(label)
            continue
        first = next(
            (line.strip() for line in output.splitlines() if line.strip().startswith("- ")),
            None,
        )
        if first is None:
            print(f"UNNAMED {label}: the probe failed without naming a rule")
            unnamed.append(label)
        else:
            print(f"caught {label}\n         -> {first}")

    if MODULE.read_bytes() != original:
        print(f"NOT RESTORED {MODULE}")
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
