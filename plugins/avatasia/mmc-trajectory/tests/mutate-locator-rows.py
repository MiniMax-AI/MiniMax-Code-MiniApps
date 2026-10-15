"""Mutation control for the locator projection.

`verify-locator-rows.mjs` states one property per case, and each mutation here breaks exactly one
of them in the shipped module. The cases that are easy to get wrong are all about **file 0**:

  - A record whose line was never located is repaired to the first source file. Nothing else about
    the answer changes — the record is still there, still searchable, still carries a byte range
    if it had one — so this is invisible until someone maps a hit back to the wrong generation.
    `buildSegment` cannot catch it: it faithfully carries whatever `fileIdx` it is handed, so the
    122 segment assertions stay green.
  - The same repair reached by the other route: the locator names a file that is not in the table
    (a source that moved) and gets filed under the first entry instead.
  - Two generations that hold a file of the same name are matched by basename rather than by full
    path, which files one generation's records under the other.

The fourth takes the byte range away, because a locator that answers "which file" but not "where
in it" cannot map a hit back to a line — and the surface still looks complete, so nothing reports
it.

Each mutation must be caught *by name*. A probe that dies on an exception names nothing, and a
control that reports that as caught is reporting a crash as if it were evidence.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
MODULE = ROOT / "miniapp" / "node" / "search-segments.mjs"
PROBE = HERE / "verify-locator-rows.mjs"

UNLOCATED = """      out.push(locator === undefined
        ? { fileIdx: -1, byteStart: -1, byteEnd: -1 }
        : {"""
UNLOCATED_REPAIRED = """      out.push(locator === undefined
        ? { fileIdx: 0, byteStart: 0, byteEnd: 0 }
        : {"""

MOVED_SOURCE = "          fileIdx: pathToFileIdx.get(locator.filePath) ?? -1,"
MOVED_REPAIRED = "          fileIdx: pathToFileIdx.get(locator.filePath) ?? 0,"

FULL_PATH = """    if (typeof file.filePath === 'string' && !pathToFileIdx.has(file.filePath)) {
      pathToFileIdx.set(file.filePath, i);
    }"""
BASENAME = """    if (typeof file.fileName === 'string' && !pathToFileIdx.has(file.fileName)) {
      pathToFileIdx.set(file.fileName, i);
    }"""

BYTES = """          byteStart: locator.start,
          byteEnd: locator.end"""
BYTES_DROPPED = """          byteStart: -1,
          byteEnd: -1"""

MUTATIONS = [
    (
        "a record with no locator is repaired to the first file instead of -1",
        UNLOCATED,
        UNLOCATED_REPAIRED,
    ),
    (
        "a locator whose file moved is filed under the first file instead of -1",
        MOVED_SOURCE,
        MOVED_REPAIRED,
    ),
    (
        "two generations holding the same file name are matched by basename",
        FULL_PATH,
        BASENAME,
    ),
    (
        "the byte range is dropped, so a hit cannot be mapped back to its line",
        BYTES,
        BYTES_DROPPED,
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
    """The first rule the probe named, or None when it failed without naming one."""
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

    original = MODULE.read_bytes()
    missed = []
    unnamed = []
    for label, old, new in MUTATIONS:
        text, newline = read_exact(MODULE)
        if old not in text:
            print(f"SKIP  {label}: anchor not found")
            missed.append(label)
            continue
        if text.count(old) != 1:
            print(f"SKIP  {label}: anchor is not unique ({text.count(old)} matches)")
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
        name = named_failure(output)
        if name is None:
            print(f"UNNAMED {label}: the probe failed without naming a rule")
            unnamed.append(label)
        else:
            print(f"caught {label}\n         -> {name.splitlines()[0]}")

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
