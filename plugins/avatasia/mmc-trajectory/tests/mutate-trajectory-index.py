"""Mutation control for verify-trajectory-index.mjs.

Each mutation reintroduces exactly one bug the probe is supposed to catch. The probe must FAIL
every time, and the file must come back byte-for-byte identical afterwards. A mutation that the
probe still passes means the assertion was tautological; a mutation whose anchor no longer exists
means the assertion went dead, which is worse — the runner reports those as misses too.

The groups are ordered by what they protect: a wrong ANSWER first, a half-written artifact second,
and the ways the index would quietly stop being equivalent to the payload last.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
MODULE = ROOT / "miniapp" / "node" / "trajectory-index.mjs"
PROBE = HERE / "verify-trajectory-index.mjs"

MUTATIONS = [
    # ---- the answer has to be the payload's answer -------------------------------------
    (
        "a record is matched to its file by name instead of by path, so every record loses its file",
        "    if (typeof file.filePath === 'string' && !pathToFileIdx.has(file.filePath)) {\n      pathToFileIdx.set(file.filePath, i);\n    }",
        "    if (typeof file.fileName === 'string' && !pathToFileIdx.has(file.fileName)) {\n      pathToFileIdx.set(file.fileName, i);\n    }",
    ),
    (
        "a missing locator is repaired to file 0 instead of admitting it has none",
        "      const fileIdx = locator === undefined ? -1 : (pathToFileIdx.get(locator.filePath) ?? -1);",
        "      const fileIdx = locator === undefined ? 0 : (pathToFileIdx.get(locator.filePath) ?? -1);",
    ),
    (
        "a missing locator is given the line's start instead of admitting it has none",
        "      line.byteStart = locator === undefined ? -1 : locator.start;",
        "      line.byteStart = locator === undefined ? 0 : locator.start;",
    ),
    (
        "the projected text fields are carried after all, putting the bulk back into the file",
        "        if (EXCLUDED_RECORD_FIELDS.has(key)) continue;\n",
        "",
    ),
    (
        "a turn is served whole even when the window holds only part of it",
        "    out.push({ turn, records: [Math.max(start, range.from), Math.min(end, range.to)] });",
        "    out.push({ turn, records: [start, end] });",
    ),
    (
        "a turn the window only touches is dropped, so its header goes with it",
        "    if (end < range.from || start > range.to) continue;",
        "    if (end < range.from || start > range.to || true) continue;",
    ),
    (
        "the window ceiling is dropped, so one request can ask for the whole lineage",
        "  const limit = Math.min(\n    typeof request.limit === 'number' && request.limit > 0 ? request.limit : MAX_WINDOW_RECORDS,\n    MAX_WINDOW_RECORDS,\n  );",
        "  const limit = typeof request.limit === 'number' && request.limit > 0 ? request.limit : MAX_WINDOW_RECORDS;",
    ),
    (
        "the timestamp side array is replaced by the records' own order, so a range bisects the primary key",
        "  timedPositions.sort((a, b) => {\n    const delta = records[a].timestamp - records[b].timestamp;\n    return delta === 0 ? a - b : delta;\n  });",
        "  timedPositions.sort((a, b) => a - b);",
    ),
    (
        "a record with no id joins the shared empty group",
        "    if (typeof record.id === 'string' && record.id.length > 0) {\n      const existing = byMessageId.get(record.id);\n      if (existing === undefined) byMessageId.set(record.id, [i]);\n      else existing.push(i);\n    }",
        "    const groupKey = typeof record.id === 'string' ? record.id : 'unkeyed';\n    {\n      const existing = byMessageId.get(groupKey);\n      if (existing === undefined) byMessageId.set(groupKey, [i]);\n      else existing.push(i);\n    }",
    ),
    # ---- a half-written artifact is never consumed --------------------------------------
    (
        "the manifest is published before the records it describes",
        "      await rename(`${recordPath}.tmp`, recordPath);",
        "      await rename(`${manifestPath}.tmp`, manifestPath);",
    ),
    (
        "the manifest keeps the machine path it was handed",
        "        files: meta.files.map(stripPath),",
        "        files: meta.files,",
    ),
    (
        "the records are accepted at whatever length they happen to be",
        "  if (lines.length !== manifest.turnCount + manifest.recordCount) return null;",
        "",
    ),
    (
        "a manifest from another schema version is served anyway",
        "    if (manifest.schemaVersion !== INDEX_SCHEMA_VERSION) return null;",
        "",
    ),
    (
        "a manifest from another projection version is served anyway",
        "    if (manifest.projectionVersion !== PROJECTION_VERSION) return null;",
        "",
    ),
    # ---- the source identity that decides reuse -----------------------------------------
    (
        "the runtime's own revision stops being compared, so a rewrite that kept the length is reused",
        "    if (typeof a.revision === 'string' && a.revision.length > 0\n      && typeof b.revision === 'string' && b.revision.length > 0 && a.revision !== b.revision) {\n      return false;\n    }\n",
        "",
    ),
    (
        "the file name stops being compared, so a replaced source answers from the old index",
        "    if (a.fileName !== b.fileName) return false;",
        "",
    ),
    (
        "a touched-but-unchanged source invalidates the index on every poll",
        "    if (a.size !== b.size) return false;",
        "    if (a.size !== b.size) return false;\n    if (a.mtimeMs !== b.mtimeMs) return false;",
    ),
    (
        # `size` is the whole file whether or not the read covered it, so this is the only thing
        # telling a generation that was read short from one that was read whole. Without it the
        # index built from a truncated generation is served as if it held every record, and a
        # search over it reports fewer matches than there are — quietly.
        "a source that was read short is trusted as if it had been read whole",
        "    if ((a.truncated === true) !== (b.truncated === true)) return false;\n    if (typeof a.revision === 'string' && a.revision.length > 0",
        "    if (typeof a.revision === 'string' && a.revision.length > 0",
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
    for label, old, new in MUTATIONS:
        text, newline = read_exact(MODULE)
        if old not in text:
            print(f"SKIP  {label}: anchor not found")
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
        else:
            first = next(
                (line.strip() for line in output.splitlines() if line.strip().startswith("- ")),
                "(no detail)",
            )
            print(f"caught {label}\n         -> {first}")

    if MODULE.read_bytes() != original:
        print(f"NOT RESTORED {MODULE}")
        return 1
    print("file restored byte-for-byte")

    if missed:
        print(f"\n{len(missed)} mutation(s) got through")
        return 1
    print(f"\nall {len(MUTATIONS)} mutations caught")
    return 0


if __name__ == "__main__":
    sys.exit(main())
