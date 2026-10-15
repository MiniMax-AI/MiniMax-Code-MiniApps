"""Mutation control for the file-index projection.

`verify-file-index-rows.mjs` states one property per case, and each mutation here breaks exactly one
of them in the shipped module. The cases that are easy to get wrong are all about **file 0**:

  - A record whose line was never located is repaired to the first source file. Nothing else about
    the answer changes — the record is still there, still searchable — so this is invisible until
    someone answers from a different generation's message. `buildSegment` cannot catch it: it
    faithfully carries whatever `fileIdx` it is handed, so every segment assertion stays green.
  - The same repair reached by the other route: the locator names a file that is not in the table
    (a source that moved) and gets filed under the first entry instead.
  - Two generations that hold a file of the same name are matched by basename rather than by full
    path, which files one generation's records under the other.

The fourth runs the other way. The projection used to copy the locator's byte range onto the row, and
that pair of fields rode along on every segment line for nothing — read back by no code in the
shipped search path, 4.36% of a real segment surface. This mutation puts them back, which is the
shape of mistake that retirement is supposed to prevent: a guard that only checks the fields it
expects will not notice a field that came back.

Its twin lives in `mutate-search-segments.py`, because the same two fields can come back at the
other end — written by `buildSegment` instead of by this projection — and a control that only owns
one of the two doors can be walked around through the other.

Each mutation must be caught *by name*. A probe that dies on an exception names nothing, and a
control that reports that as caught is reporting a crash as if it were evidence.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
MODULE = ROOT / "miniapp" / "node" / "search-segments.mjs"
PROBE = HERE / "verify-file-index-rows.mjs"

ROW = "{ fileIdx: pathToFileIdx.get(locator.filePath) ?? -1 }"
ROW_UNLOCATED = "? { fileIdx: -1 }\n        : " + ROW + ");"

UNLOCATED_REPAIRED = "? { fileIdx: 0 }\n        : " + ROW + ");"
BYTES_BACK = ("? { fileIdx: -1, byteStart: -1, byteEnd: -1 }\n        : "
              "{ fileIdx: pathToFileIdx.get(locator.filePath) ?? -1, "
              "byteStart: locator.start, byteEnd: locator.end });")

MOVED_REPAIRED = "{ fileIdx: pathToFileIdx.get(locator.filePath) ?? 0 }"

FULL_PATH = """    if (typeof file.filePath === 'string' && !pathToFileIdx.has(file.filePath)) {
      pathToFileIdx.set(file.filePath, i);
    }"""
BASENAME = """    if (typeof file.fileName === 'string' && !pathToFileIdx.has(file.fileName)) {
      pathToFileIdx.set(file.fileName, i);
    }"""

MUTATIONS = [
    (
        "a record with no locator is repaired to the first file instead of -1",
        ROW_UNLOCATED,
        UNLOCATED_REPAIRED,
    ),
    (
        "a locator whose file moved is filed under the first file instead of -1",
        ROW,
        MOVED_REPAIRED,
    ),
    (
        "two generations holding the same file name are matched by basename",
        FULL_PATH,
        BASENAME,
    ),
    (
        "the byte range is copied onto the row again, so it rides along on every segment",
        ROW_UNLOCATED,
        BYTES_BACK,
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
