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
        "the scan counts only non-empty lines, so every ordinal after an empty record is one short",
        "    if (line.includes(needle)) hits.push(ordinal);\n    ordinal += 1;",
        "    if (line.includes(needle)) hits.push(ordinal);\n    if (line !== '') ordinal += 1;",
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
        "a surface with a line the locators do not account for is accepted",
        "  if (lines.length !== manifest.recordCount) return null;",
        "",
    ),
    (
        "the runtime's own revision stops being compared, so a rewrite that kept the length is reused",
        "    if (typeof a.revision === 'string' && a.revision.length > 0\n      && typeof b.revision === 'string' && b.revision.length > 0 && a.revision !== b.revision) {\n      return false;\n    }\n",
        "",
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
