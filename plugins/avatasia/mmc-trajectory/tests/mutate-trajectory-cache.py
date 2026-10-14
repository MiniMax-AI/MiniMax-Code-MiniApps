"""Mutation control for verify-trajectory-cache.mjs.

Each mutation reintroduces exactly one bug the probe is supposed to catch. The probe must FAIL
every time, and the file must come back byte-for-byte identical afterwards. A mutation that the
probe still passes means the assertion was tautological; a mutation whose anchor no longer exists
means the assertion went dead, which is worse — the runner reports those as misses too.

The first four are the ones that matter: they each break a DIFFERENT part of the family mechanism,
because a bug that collapsed two of them would still be caught by the wrong assertion and we would
not learn which one mattered.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SERVER = ROOT / "miniapp" / "node" / "server.mjs"
PROBE = HERE / "verify-trajectory-cache.mjs"

FAMILY_EVICT = """      for (const [existingKey, existing] of entries) {
        if (existingKey !== key && existing.family === family) entries.delete(existingKey);
      }
"""

LIMIT_EVICT = """      while (entries.size > limit) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
"""

RECENCY = """      // Re-reading is the only signal that an entry is still hot, so it refreshes recency.
      entries.delete(key);
      entries.set(key, hit);
      return hit.value;
"""

MUTATIONS = [
    # ---- the family mechanism, one piece at a time ----------------------------------
    (
        "the cache stops dropping a superseded version, so growth stacks bodies again",
        SERVER,
        FAMILY_EVICT,
        "",
    ),
    (
        "the route names the whole key as the family, so every version is its own family",
        SERVER,
        "trajectoryCache.set(cacheKey, trajectoryCacheFamily(entry.dir, filter), { at: Date.now(), etag, body, raws, decoded: new Map() });",
        "trajectoryCache.set(cacheKey, cacheKey, { at: Date.now(), etag, body, raws, decoded: new Map() });",
    ),
    (
        "the family stops naming the slice, so one session's generations evict each other",
        SERVER,
        "  const gen = filter === null || filter === undefined ? 'all' : String(filter);\n  return `${dir}|gen=${gen}|`;",
        "  return `${dir}|gen=all|`;",
    ),
    (
        "the family stops naming the session, so two sessions evict each other",
        SERVER,
        "  return `${dir}|gen=${gen}|`;",
        "  return `|gen=${gen}|`;",
    ),
    (
        "the family comparison is dropped, so a newer version keeps its predecessor",
        SERVER,
        "        if (existingKey !== key && existing.family === family) entries.delete(existingKey);",
        "        if (existingKey === key) entries.delete(existingKey);",
    ),
    # ---- the bound ------------------------------------------------------------------
    (
        "the entry bound stops evicting, so distinct sessions grow without limit",
        SERVER,
        LIMIT_EVICT,
        "",
    ),
    (
        "reading stops refreshing recency, so the family the reader keeps asking for is evicted",
        SERVER,
        RECENCY,
        "      return hit.value;\n",
    ),
    # ---- structure ------------------------------------------------------------------
    (
        "the cache becomes a module-level singleton, shared across every runtime instance",
        SERVER,
        "  const trajectoryCache = createTrajectoryCache(TRAJECTORY_CACHE_ENTRIES);",
        "  globalThis.__trajectoryCache = globalThis.__trajectoryCache || createTrajectoryCache(TRAJECTORY_CACHE_ENTRIES);\n  const trajectoryCache = globalThis.__trajectoryCache;",
    ),
    (
        "the key stops carrying the active file's size, so a grown session serves a stale body",
        SERVER,
        "  return `${trajectoryCacheFamily(entry.dir, filter)}${lineage}|${entry.sizeBytes}|${entry.lastActiveAt}|${identity.catalogBytes ?? ''}|${bind}`;",
        "  return `${trajectoryCacheFamily(entry.dir, filter)}${lineage}|${entry.lastActiveAt}|${identity.catalogBytes ?? ''}|${bind}`;",
    ),
    (
        "the key stops carrying the lineage, so a compaction that only rotated snapshots serves a stale body",
        SERVER,
        "  return `${trajectoryCacheFamily(entry.dir, filter)}${lineage}|${entry.sizeBytes}|${entry.lastActiveAt}|${identity.catalogBytes ?? ''}|${bind}`;",
        "  return `${trajectoryCacheFamily(entry.dir, filter)}${entry.sizeBytes}|${entry.lastActiveAt}|${identity.catalogBytes ?? ''}|${bind}`;",
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
