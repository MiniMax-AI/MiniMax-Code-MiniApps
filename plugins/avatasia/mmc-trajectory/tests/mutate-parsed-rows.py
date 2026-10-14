"""Mutation control for verify-parsed-rows.mjs.

Each mutation reintroduces exactly one bug the probe is supposed to catch. The probe must FAIL
every time, and the file must come back byte-for-byte identical afterwards. A mutation that the
probe still passes means the assertion was tautological; a mutation whose anchor no longer
exists means the assertion went dead, which is worse — the runner reports those as misses too.

Every mutation here is non-trivial: it changes behaviour under the condition the assertion is
about, not just text. In particular the four key mutations each break a *different* component,
because a key that drops two of them would still be caught by the wrong test and we would not
learn which one mattered.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SERVER = ROOT / "miniapp" / "node" / "server.mjs"
PROBE = HERE / "verify-parsed-rows.mjs"

MUTATIONS = [
    # ---- the key: each component removed on its own -------------------------------
    (
        "server: the key stops naming the file, so two sessions share their messages.jsonl",
        SERVER,
        "  return `${filePath}|${size}|${mtimeMs}|${limit}`;",
        "  return `${filePath.split(/[\\\\/]/).pop()}|${size}|${mtimeMs}|${limit}`;",
    ),
    (
        "server: the key stops carrying the size, so a grown file serves a stale tail",
        SERVER,
        "  return `${filePath}|${size}|${mtimeMs}|${limit}`;",
        "  return `${filePath}|${mtimeMs}|${limit}`;",
    ),
    (
        "server: the key stops carrying the mtime, so a same-size rewrite serves stale rows",
        SERVER,
        "  return `${filePath}|${size}|${mtimeMs}|${limit}`;",
        "  return `${filePath}|${size}|${limit}`;",
    ),
    (
        "server: the key stops carrying the limit, so the truncation verdict is read at another width",
        SERVER,
        "  return `${filePath}|${size}|${mtimeMs}|${limit}`;",
        "  return `${filePath}|${size}|${mtimeMs}|64 * 1024 * 1024`;",
    ),
    # ---- the cache value ----------------------------------------------------------
    (
        "server: `empty` is not carried on the cached value, so a hit stops reporting it",
        SERVER,
        "    empty: head.buffer.length === 0,\n",
        "    empty: false,\n",
    ),
    (
        "server: `skipped` is not carried, so a hit under-counts the lines it dropped",
        SERVER,
        "    skipped: parsed.skipped,\n",
        "    skipped: 0,\n",
    ),
    # ---- the budget ---------------------------------------------------------------
    (
        "the budget stops evicting, so the cache grows without limit",
        SERVER,
        """      while (bytes > budget && entries.size > 1) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        const victim = entries.get(oldest.value);
        entries.delete(oldest.value);
        bytes -= victim ? victim.size : 0;
      }
""",
        "",
    ),
    (
        "reading stops refreshing recency, so the 22 frozen files get evicted by insertion order",
        SERVER,
        """      // Re-reading is the only signal that a file is still hot, so it refreshes recency.
      entries.delete(key);
      entries.set(key, hit);
      return hit.value;
""",
        "      return hit.value;\n",
    ),
    (
        "an entry larger than the whole budget is stored anyway, evicting everything for one hit",
        SERVER,
        "      if (size > budget) return bytes;\n",
        "",
    ),
    (
        "re-storing a key double-counts it, so the budget shrinks over time",
        SERVER,
        """      const previous = entries.get(key);
      if (previous !== undefined) {
        bytes -= previous.size;
        entries.delete(key);
      }
""",
        "",
    ),
    # ---- structure ----------------------------------------------------------------
    (
        "the cache becomes a module-level singleton, shared across every runtime instance",
        SERVER,
        "  const parsedRows = createParsedRowsCache(PARSED_ROWS_CACHE_BYTES);",
        "  globalThis.__parsedRows = globalThis.__parsedRows || createParsedRowsCache(PARSED_ROWS_CACHE_BYTES);\n  const parsedRows = globalThis.__parsedRows;",
    ),
    (
        "the route parses the file inline again instead of going through the cache",
        SERVER,
        "        parsedFile = await loadParsedRows(parsedRows, filePath, limit, { cacheable: link.fileName !== activeFileName });",
        "        parsedFile = await (async () => { const h = await readHead(filePath, limit); const p = parseMessagesJsonl(h.buffer); return { rows: p.rows, locators: p.spans.map(([s, e]) => ({ start: s, end: e, digest: lineDigest(h.buffer.subarray(s, e)) })), skipped: p.skipped, size: h.size, read: h.read, empty: h.buffer.length === 0, truncated: truncatedByCap(h.size, limit) }; })();",
    ),
]


def read_exact(path):
    """Normalise to LF for matching, and report the file's own newline so it can be put back.

    server.mjs is CRLF in the working tree. Matching against the raw bytes would make every
    multi-line anchor miss — which the runner reports as a surviving mutation, so the failure
    looks like a dead guard rather than a broken anchor.
    """
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