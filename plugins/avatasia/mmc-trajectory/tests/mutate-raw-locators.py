"""Mutation control for verify-raw-locators.mjs.

Each mutation reintroduces exactly one bug the guard is supposed to catch, and the guard must FAIL
every time. A mutation the guard still passes means the assertion was tautological; a mutation whose
anchor no longer exists means the assertion went dead, which is worse — the runner reports both as
misses, and they look the same from outside.

The two that matter most are here in the middle, and they are deliberately near-neighbours:

  * a span recorded as a character offset rather than a byte offset, and
  * a digest taken over the wrong slice.

Both leave /raw answering 200 with a plausible message. Neither throws, neither logs, and neither
changes a number any surface reports. The only thing standing between them and a wrong answer is
the guard, which is why they get one each rather than being folded together.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SERVER = ROOT / "miniapp" / "node" / "server.mjs"
CLIENT = ROOT / "miniapp" / "client" / "index.html"
PROBE = HERE / "verify-raw-locators.mjs"

MUTATIONS = [
    # ---- the positions ---------------------------------------------------------------
    (
        "server: a span is off by one byte, so it reads the tail of the previous line",
        SERVER,
        "          spans.push([start, end]);",
        "          spans.push([start + 1, end]);",
    ),
    (
        "server: the span runs to the start of the next line instead of the end of this one",
        SERVER,
        "    const end = newline === -1 ? bytes.length : newline;",
        "    const end = newline === -1 ? bytes.length : newline + 1;",
    ),
    (
        "server: the locator's digest is taken over the whole file rather than the line",
        SERVER,
        "    digest: lineDigest(head.buffer.subarray(start, end)),",
        "    digest: lineDigest(head.buffer),",
    ),
    (
        "server: the digest swallows the line's newline, so the line and the line plus its terminator agree on nothing",
        SERVER,
        "    digest: lineDigest(head.buffer.subarray(start, end)),",
        "    digest: lineDigest(head.buffer.subarray(start, end + 1)),",
    ),
    (
        "server: the digest is truncated to 32 bits, where a session's worth of lines can collide",
        SERVER,
        "  return createHash('sha256').update(bytes).digest('hex').slice(0, LINE_DIGEST_CHARS);",
        "  return createHash('sha256').update(bytes).digest('hex').slice(0, 8);",
    ),
    # ---- readRange --------------------------------------------------------------------
    (
        "server: a locator forgets which file it came from, so /raw has nowhere to read from",
        SERVER,
        """  const locators = parsed.spans.map(([start, end]) => ({
    filePath,
    start,""",
        """  const locators = parsed.spans.map(([start, end]) => ({
    start,""",
    ),    (
        "server: readRange hands back whatever it managed to read instead of refusing it",
        SERVER,
        """    const stat = await handle.stat();
    if (stat.size < end) return null;
    const buffer = Buffer.allocUnsafe(end - start);
    let filled = 0;
    while (filled < buffer.length) {
      const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, start + filled);
      if (bytesRead <= 0) return null;
      filled += bytesRead;
    }
""",
        """    const buffer = Buffer.allocUnsafe(end - start);
    let filled = 0;
    while (filled < buffer.length) {
      const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, start + filled);
      if (bytesRead <= 0) break;
      filled += bytesRead;
    }
""",
    ),
    (
        "server: readRange clamps a backwards range instead of refusing it",
        SERVER,
        "  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) return null;",
        "  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0) return null;\n  if (end <= start) end = start + 1;",
    ),
    (
        "server: a missing file throws out of readRange instead of answering null",
        SERVER,
        "  let handle;\n  try {\n    handle = await open(filePath, 'r');\n  } catch {\n    return null;\n  }",
        "  const handle = await open(filePath, 'r');",
    ),
    # ---- what is retained --------------------------------------------------------------
    (
        "server: the active file is cached again, which is the 233 MB this change removed",
        SERVER,
        "loadParsedRows(parsedRows, filePath, limit, { cacheable: link.fileName !== activeFileName })",
        "loadParsedRows(parsedRows, filePath, limit)",
    ),
    (
        "server: cacheable:false stores anyway, so the rows come back",
        SERVER,
        "  if (cacheable) cache.set(key, value, Math.ceil(head.size * PARSED_ROWS_HEAP_PER_SOURCE_BYTE));",
        "  cache.set(key, value, Math.ceil(head.size * PARSED_ROWS_HEAP_PER_SOURCE_BYTE));",
    ),
    (
        "server: cacheable:false still reads through the cache, so a stale sealed parse is served",
        SERVER,
        "  if (cacheable) {\n    const hit = cache.get(key);\n    if (hit !== null) return hit;\n  }",
        "  const hit = cache.get(key);\n  if (hit !== null) return hit;",
    ),
    (
        "server: the active file is decided by being the last one read rather than by name",
        SERVER,
        "cacheable: link.fileName !== activeFileName",
        "cacheable: link.generation !== generations[generations.length - 1].generation",
    ),
    (
        "server: the rows are put back into the cache entry, so the object graph stays resident",
        SERVER,
        "body, raws, decoded: new Map() });",
        "body, raws, decoded: new Map(), rows });",
    ),
    (
        "server: the rows are never released, so the request holds them until it returns",
        SERVER,
        "    rows.length = 0;\n    rowLocators.length = 0;",
        "    rowLocators.length = 0;",
    ),
    (
        "server: the decode cache is unbounded",
        SERVER,
        "    while (cached.decoded.size > RAW_DECODE_CACHE_ENTRIES) {",
        "    while (false) {",
    ),
    # ---- what /raw does with what it found --------------------------------------------
    (
        "server: /raw serves the line without checking it is still the line the record describes",
        SERVER,
        "if (bytes === null || lineDigest(bytes) !== locator.digest) {",
        "if (bytes === null) {",
    ),
    (
        "server: /raw ignores where the line actually starts",
        SERVER,
        "const bytes = await readRange(locator.filePath, locator.start, locator.end);",
        "const bytes = await readRange(locator.filePath, locator.start, locator.end + 1);",
    ),
    # ---- the page's own copy -----------------------------------------------------------
    (
        "client: the page's raw cache key drops the validator, so a moved-on session keeps its old messages",
        CLIENT,
        "        return sid + '#' + gen + '#' + (state.etag || '') + '#' + index;",
        "        return sid + '#' + gen + '#' + index;",
    ),
    (
        "client: a refused raw is reloaded and retried, turning a hint into a reload the reader never asked for",
        CLIENT,
        "if (!retried && err && err.code === 'trajectory_not_cached') {",
        "if (!retried && err && (err.code === 'trajectory_not_cached' || err.code === 'raw_stale')) {",
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

    originals = {path: path.read_bytes() for path in {m[1] for m in MUTATIONS}}
    missed = []
    for label, path, old, new in MUTATIONS:
        text, newline = read_exact(path)
        if old not in text:
            print(f"SKIP  {label}: anchor not found in {path.name}")
            missed.append(label)
            continue
        write_exact(path, text.replace(old, new, 1), newline)
        try:
            code, output = run_probe()
        finally:
            path.write_bytes(originals[path])
        if code == 0:
            print(f"MISSED {label}: the probe still passed")
            missed.append(label)
        else:
            first = next(
                (line.strip() for line in output.splitlines() if line.strip().startswith("- ")),
                "(no detail)",
            )
            print(f"caught {label}\n         -> {first}")

    for path, data in originals.items():
        if path.read_bytes() != data:
            print(f"NOT RESTORED {path}")
            return 1
    print("all files restored byte-for-byte")

    if missed:
        print(f"\n{len(missed)} mutation(s) got through")
        return 1
    print(f"\nall {len(MUTATIONS)} mutations caught")
    return 0


if __name__ == "__main__":
    sys.exit(main())
