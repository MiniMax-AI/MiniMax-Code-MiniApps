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
        "trajectoryCache.set(cacheKey, trajectoryCacheFamily(entry.dir, filter), identity.id ?? '', { at: Date.now(), etag, body, raws, rowPos: rowPosByRecord, decoded: new Map() });",
        "trajectoryCache.set(cacheKey, cacheKey, identity.id ?? '', { at: Date.now(), etag, body, raws, rowPos: rowPosByRecord, decoded: new Map() });",
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
        "  return `${trajectoryCacheFamily(entry.dir, filter)}${identity.id ?? ''}|${lineage}|${entry.sizeBytes}|${entry.lastActiveAt}|${identity.catalogBytes ?? ''}|${bind}`;",
        "  return `${trajectoryCacheFamily(entry.dir, filter)}${identity.id ?? ''}|${lineage}|${entry.lastActiveAt}|${identity.catalogBytes ?? ''}|${bind}`;",
    ),
    (
        "the key stops carrying the lineage, so a compaction that only rotated snapshots serves a stale body",
        SERVER,
        "  return `${trajectoryCacheFamily(entry.dir, filter)}${identity.id ?? ''}|${lineage}|${entry.sizeBytes}|${entry.lastActiveAt}|${identity.catalogBytes ?? ''}|${bind}`;",
        "  return `${trajectoryCacheFamily(entry.dir, filter)}${identity.id ?? ''}|${entry.sizeBytes}|${entry.lastActiveAt}|${identity.catalogBytes ?? ''}|${bind}`;",
    ),
    (
        "the key stops naming the identity, so one session's body can be served for another",
        SERVER,
        "  return `${trajectoryCacheFamily(entry.dir, filter)}${identity.id ?? ''}|${lineage}|${entry.sizeBytes}|${entry.lastActiveAt}|${identity.catalogBytes ?? ''}|${bind}`;",
        "  return `${trajectoryCacheFamily(entry.dir, filter)}${lineage}|${entry.sizeBytes}|${entry.lastActiveAt}|${identity.catalogBytes ?? ''}|${bind}`;",
    ),
    # ---- the family as the way back to the body ---------------------------------------
    #
    # The key names the version and the family names the question. A poll that asked for
    # `latest` and a read that asked for that session by its id are the same reader of the
    # same body, but the two computed different keys -- the poll's key carries the binding it
    # resolved and the read's does not -- so the read missed a body the service was holding
    # and answered 「会话数据已释放，请重新加载」 for a conversation on screen.
    #
    # Five controls, because the promise is carried by five separate pieces and a control
    # that broke two of them would leave the others never asked whether they could fail:
    # the request has to resolve the family, the cache has to be able to look one up, the
    # lookup has to refresh recency, and EACH of the two readers has to use it.
    (
        "the request stops resolving the family, so neither reader can look one up",
        SERVER,
        "      family: trajectoryCacheFamily(entry.dir, filter),\n",
        "",
    ),
    (
        "the raw read stops falling back to the family, so a record of the conversation on screen is unreachable",
        SERVER,
        "    // The key names the version and the family names the question — see `handleRaw` for why the\n"
        "    // family is the fallback, and why the session is part of it.\n"
        "    const cached = trajectoryCache.get(ctx.cacheKey) ?? trajectoryCache.getByFamily(ctx.family, ctx.identityId);",
        "    // The key names the version and the family names the question — see `handleRaw` for why the\n"
        "    // family is the fallback, and why the session is part of it.\n"
        "    const cached = trajectoryCache.get(ctx.cacheKey);",
    ),
    (
        "the record read stops falling back to the family, so the four fields of a record are unreachable",
        SERVER,
        "    // The session is part of the question: a directory can stop holding one session and start\n"
        "    // holding another, and the old session's body is not an answer about the new one.\n"
        "    const cached = trajectoryCache.get(ctx.cacheKey) ?? trajectoryCache.getByFamily(ctx.family, ctx.identityId);",
        "    // The session is part of the question: a directory can stop holding one session and start\n"
        "    // holding another, and the old session's body is not an answer about the new one.\n"
        "    const cached = trajectoryCache.get(ctx.cacheKey);",
    ),
    (
        "the cache stops finding an entry by its family, so the fallback finds nothing",
        SERVER,
        "    getByFamily(family, identityId) {\n"
        "      for (const [key, hit] of entries) {\n"
        "        if (hit.family !== family) continue;\n"
        "        if (hit.identityId !== identityId) continue;\n"
        "        // Re-reading is the only signal that an entry is still hot, so it refreshes recency.\n"
        "        entries.delete(key);\n"
        "        entries.set(key, hit);\n"
        "        return hit.value;\n"
        "      }\n"
        "      return null;\n"
        "    },",
        "    getByFamily(family) {\n"
        "      return null;\n"
        "    },",
    ),
    (
        "reading by family stops refreshing recency, so the family being read is the first evicted",
        SERVER,
        "        if (hit.family !== family) continue;\n"
        "        if (hit.identityId !== identityId) continue;\n"
        "        // Re-reading is the only signal that an entry is still hot, so it refreshes recency.\n"
        "        entries.delete(key);\n"
        "        entries.set(key, hit);\n"
        "        return hit.value;",
        "        if (hit.family !== family) continue;\n"
        "        if (hit.identityId !== identityId) continue;\n"
        "        return hit.value;",
    ),
    # ---- the session the entry is about ------------------------------------------------
    #
    # The family names the QUESTION — the directory and the slice — and one family is asked by
    # many readers, so the family cannot also carry the session. The entry remembers which
    # session it is about, and the lookup names the session it wants.
    #
    # Three controls, because the promise has three pieces and a control that broke two of them
    # would leave the third never asked whether it could fail: the lookup has to CHECK the
    # session, the route has to RECORD it, and the request has to RESOLVE it.
    #
    # This is the defect the acceptance review found: a directory can stop holding one session
    # and start holding another, and the family then finds the OLD session's entry — whose
    # decoded messages are the old session's messages. A read for the new session answered with
    # the old one's words.
    (
        "the family lookup stops checking the session the entry is about",
        SERVER,
        "        if (hit.identityId !== identityId) continue;\n",
        "",
    ),
    (
        "the route stops recording the session the entry is about",
        SERVER,
        "trajectoryCache.set(cacheKey, trajectoryCacheFamily(entry.dir, filter), identity.id ?? '', { at: Date.now(), etag, body, raws, rowPos: rowPosByRecord, decoded: new Map() });",
        "trajectoryCache.set(cacheKey, trajectoryCacheFamily(entry.dir, filter), '', { at: Date.now(), etag, body, raws, rowPos: rowPosByRecord, decoded: new Map() });",
    ),
    (
        "the request stops resolving the session it will look up",
        SERVER,
        "      identityId: identity.id ?? '',\n",
        "      identityId: '',\n",
    ),
    # ---- the version of a record, which is what a position read has to name ------------
    #
    # A record index is a POSITION, and the same position in two bodies can be two different
    # records: a transcript rewritten under a running page leaves the indexes alone and changes
    # the records behind them. The session and the slice say WHICH BODY an answer is about; the
    # version says WHICH RECORD an index names. Without it, a read for the old body is answered
    # with the new body's record under the old body's number.
    (
        "the body stops stamping its records with their version",
        SERVER,
        "    stampRecordVersions(payload, raws);\n",
        "",
    ),
    (
        "the raw read stops checking which version of the record it is serving",
        SERVER,
        "    const refused = missingRecordVersion(url) ?? mismatchedRecordVersion(url, locator, rowPos);\n"
        "    if (refused) {\n"
        "      context.logger.warn('miniapp.trajectory.read_error', { reason: refused.code });\n"
        "      sendError(response, refused.status, refused.code, refused.message);\n"
        "      return;\n"
        "    }\n"
        "    // Re-reading a record the reader has already opened is the common case",
        "    const refused = missingRecordVersion(url);\n"
        "    if (refused) {\n"
        "      context.logger.warn('miniapp.trajectory.read_error', { reason: refused.code });\n"
        "      sendError(response, refused.status, refused.code, refused.message);\n"
        "      return;\n"
        "    }\n"
        "    // Re-reading a record the reader has already opened is the common case",
    ),
    (
        "the record read stops checking which version of the record it is serving",
        SERVER,
        "    const refused = missingRecordVersion(url) ?? mismatchedRecordVersion(url, locator, rowPos);\n"
        "    if (refused) {\n"
        "      context.logger.warn('miniapp.trajectory.read_error', { reason: refused.code });\n"
        "      sendError(response, refused.status, refused.code, refused.message);\n"
        "      return;\n"
        "    }\n"
        "    const found = await readRecordRow(locator);\n"
        "    if ('error' in found) {\n"
        "      context.logger.warn('miniapp.trajectory.read_error', { reason: `record_${found.reason}` });",
        "    const refused = missingRecordVersion(url);\n"
        "    if (refused) {\n"
        "      context.logger.warn('miniapp.trajectory.read_error', { reason: refused.code });\n"
        "      sendError(response, refused.status, refused.code, refused.message);\n"
        "      return;\n"
        "    }\n"
        "    const found = await readRecordRow(locator);\n"
        "    if ('error' in found) {\n"
        "      context.logger.warn('miniapp.trajectory.read_error', { reason: `record_${found.reason}` });",
    ),
    (
        "a read that does not name the record it means is answered anyway",
        SERVER,
        "    if (typeof asked === 'string' && asked !== '') return null;\n"
        "    return { status: 400, code: 'record_version_required', message: '缺少记录版本，请重新加载会话' };",
        "    if (true) return null;\n"
        "    return { status: 400, code: 'record_version_required', message: '缺少记录版本，请重新加载会话' };",
    ),
    (
        "the search stops carrying the version of the record each hit names",
        SERVER,
        "        v: typeof record.v === 'string' ? record.v : '',\n",
        "        v: '',\n",
    ),
    # ---- the slice the body IS, which the page compares every answer against -----------
    #
    # The service publishes which slice a body is, and the page compares the slice of every
    # answer it gets against the slice of the body on screen. If the two words mean different
    # things, the comparison is between two different questions and a mismatch means nothing.
    (
        "the body stops naming the slice it is for, and names the generations it happens to show",
        SERVER,
        "      generation: filter,\n",
        "      generation: shown.length === 1 ? shown[0].generation : null,\n",
    ),
    (
        "the search answer names a generation when no slice was asked for",
        SERVER,
        "        session: { id: ctx.identity.id, generation: filter },\n",
        "        session: { id: ctx.identity.id, generation: filter === null ? 0 : filter },\n",
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
    unnamed = []
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
            continue
        # A probe that failed without naming a rule has not said WHICH rule broke, so it has not
        # shown that the guard owns this mutation. It is weaker than "caught", and it is reported
        # as its own thing rather than folded into the count of survivors.
        first = next(
            (line.strip() for line in output.splitlines() if line.strip().startswith("- ")),
            None,
        )
        if first is None:
            print(f"UNNAMED {label}: the probe failed without naming a rule")
            unnamed.append(label)
        else:
            print(f"caught {label}\n         -> {first}")

    for path, data in originals.items():
        if path.read_bytes() != data:
            print(f"NOT RESTORED {path}")
            return 1
    print("all files restored byte-for-byte")

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
