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
# A case may name its own probe, and this is the other one: the cap on the fold over the first
# N records is owned by `verify-incremental.mjs`, which is where the assertion about it lives. A
# case that ran this file's probe instead would be asking a guard that never heard of the rule,
# and would report the mutation as survived.
INCREMENTAL_PROBE = HERE / "verify-incremental.mjs"

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
    # ---- the answer has to be about the SET the page is showing --------------------------
    #
    # A search answer says 「these records match and the rest do not」, and the part of it that
    # matters to the reader is the part it does NOT name: a record this body has and that body
    # does not match gets dimmed as if it did not contain the needle, with nothing saying so.
    #
    # So the request says which set it is about — how many records the page has, and a fingerprint
    # of their versions — and the service answers only if it searched THAT set. Three controls,
    # because the promise has three halves: the set the page names has to be checked, the set the
    # SEGMENTS stand for has to be checked too (the fast path is a different body by another
    # route), and a request that names no set at all has to be refused rather than guessed at.
    (
        "the search answers about a set the page did not name",
        SERVER,
        "    if (recordSetFingerprint(payloadRecordVersions(payload, count)) !== askedFingerprint) {\n"
        "      sendError(response, 409, 'search_version_mismatch', '该记录所在的版本已变化，请重新加载会话');\n"
        "      return;\n"
        "    }\n",
        "",
    ),
    (
        "the search never checks the set the stored segments stand for",
        SERVER,
        "      if (onDisk.fingerprint !== askedFingerprint) {\n"
        "        sendError(response, 409, 'search_version_mismatch', '该记录所在的版本已变化，请重新加载会话');\n"
        "        return;\n"
        "      }\n",
        "",
    ),
    (
        "a search that does not say which set it is about is answered anyway",
        SERVER,
        "    if (!Number.isInteger(count) || count < 0 || !/^[0-9a-f]{16}$/.test(askedFingerprint)) {\n"
        "      sendError(response, 400, 'search_fingerprint_required', '会话已更新，请重新加载后再搜索');\n"
        "      return;\n"
        "    }\n",
        "",
    ),
    # ---- the tail, which is about the set the page holds -------------------------------
    #
    # A tail carries the records AFTER the page's cursor; the ones before it stay as the page
    # has them. So the tail is only about the page's copy if that copy is still the service's —
    # and a record rewritten IN PLACE keeps its index and its id, so the cursor still points at
    # the same record, the tail looks empty, and the page merges nothing: it keeps the old text
    # and installs the new body's validator. Nothing else in the protocol could see it.
    #
    # Three controls, because the promise has three pieces: a tail to a page whose copy has
    # changed has to be refused, a tail asked for without the set has to be refused rather than
    # guessed at, and the path that finds the body already held has to answer with the WHOLE
    # body — a tail from there would be a tail nobody checked.
    (
        "a tail is answered to a page whose copy is not the one the service has",
        SERVER,
        "  if (recordSetFingerprint(payloadRecordVersions(payload, count)) !== fingerprint) {\n",
        "  if (false) {\n",
    ),
    (
        "a tail asked for without saying which set the page holds is answered anyway",
        SERVER,
        "  if (!Number.isInteger(count) || count < 0 || !/^[0-9a-f]{16}$/.test(fingerprint)) {\n",
        "  if (false) {\n",
    ),
    (
        "the cached path stops answering with the body it holds, so a tail is cut from it unchecked",
        SERVER,
        "      sendJsonBody(response, 200, cached.body, { etag, revalidate: true });\n      return;\n",
        "      // the body is rebuilt below\n",
    ),
    # ---- the order the first N records are folded over ---------------------------------
    #
    # The answer is about a SET of records, and the set is the first N of the body — the body in
    # LEDGER order, which is turn by turn. The segments are one file per generation, read oldest
    # first, and a record that belongs to an EARLIER turn can live in a LATER file: the first N
    # records of the files are then not the first N records of the body. A fold over the files
    # answers about a different set, the fingerprint of the first N does not match the one the
    # page asked for, and the service refuses a body that did not change at all.
    #
    # The control below breaks the reconstruction by sorting on the record's own number, which is
    # the order the files hold — the mistake reads as a simplification, because a record's number
    # does order the records of one turn.
    (
        "the cached path folds the versions in the order the files hold them, not the order the ledger draws them",
        SERVER,
        "  placed.sort(byLedgerOrder);",
        "  placed.sort((a, b) => a.index - b.index);",
        "a cached search accepts the unchanged displayed set when an earlier turn gains a record in a later generation",
    ),
    (
        # The hits are reported in the ledger's order, which is the order the rebuild reports them
        # in. The record's own number is NOT that order: a record that belongs to an earlier turn
        # and arrived after that turn was written is emitted later than a record of a later turn,
        # and the ledger still draws it first. Sorted by the number alone, the cached path answers
        # the same question in a different order — and two answers that differ only in order are
        # two answers.
        "the cached path sorts its hits by the record's number, so it answers in a different order than the rebuild",
        SERVER,
        "    hits.sort(byLedgerOrder);",
        "    hits.sort((a, b) => a.index - b.index);",
        "a cached search returns its hits in the same order the rebuild returns them",
    ),
    (
        # The cap on the hits is about WHICH records the answer is about. The rebuilt path keeps the
        # first N it meets while it walks the body turn by turn, so it keeps the first N in the
        # ledger's order. A path that caps while it walks the GENERATIONS keeps the first N in the
        # order the generations happened to be in — and when the two orders disagree, that is a
        # different SET of records, with the same count and the same fingerprint. Nothing downstream
        # can notice: the page turns the hits into a set of record numbers and lights up those rows.
        "the cached path caps the hits while it walks the generations, so it answers with a different set of records",
        SERVER,
        "        hits.push(hit);",
        "        if (hits.length < MAX_SEARCH_HITS) hits.push(hit);",
        "and it answers with the same records as the rebuild",
    ),
    (
        # The order itself, not the calls that use it. The two controls above change what the
        # comparator is called with; this one changes what it does, so a comparator that had been
        # quietly wrong would be caught even if every call site still said `byLedgerOrder`.
        "the ledger's order compares the turns the wrong way round",
        SERVER,
        "  if (turnA !== turnB) return turnA - turnB;",
        "  if (turnA !== turnB) return turnB - turnA;",
        "a cached search accepts the unchanged displayed set when an earlier turn gains a record in a later generation",
    ),
    # ---- a set of segments that does not cover the whole body -------------------------------
    #
    # A record with no locator names no file, so it belongs to no generation's segment: the
    # segments cover fewer records than the body, and the fold over them is a fold over a
    # DIFFERENT set of records. The fingerprint of that set is not the one the page is holding, so
    # the service refuses a body that did not change at all — and the reader is told the session
    # moved when nothing moved.
    #
    # Two controls, one for each half. The reader's half is the refusal: without it the cached path
    # answers from a set that is short. The publish's half is the count: a publish that counted
    # nothing would write 「the set covers the whole body」 for a set that does not, and the reader
    # would have nothing to refuse.
    (
        "the cached path answers from a set of segments that does not cover the whole body",
        SERVER,
        "      if (segment.manifest.uncovered > 0) return null;\n",
        "",
        "a search whose segments do not cover the whole body is answered by the rebuild",
    ),
    (
        "the publish counts nothing, so a set that does not cover the body says it covers it",
        SERVER,
        "    const uncovered = uncoveredRecordCount(fileIdxRows);",
        "    const uncovered = 0;",
        "the publish counts the records no segment covers, and hands the count to the manifest",
    ),
    # ---- the cap on the fold over the first N records ---------------------------------
    #
    # The cap is checked BEFORE the push, so a limit of zero is zero records. Checked after the
    # push it is one, and the fold over the page's empty set then never matches the service's fold
    # over its empty set -- so a request for a tail over no records is refused for ever.
    #
    # The two readings of "the versions of the first N records" are in two files -- this one in
    # `server.mjs`, the other in `search-segments.mjs` -- and they have to agree, which is why the
    # case below names the guard that owns the rule rather than this file's own probe.
    (
        "the cap on the fold is checked after the push, so a limit of zero still yields one version",
        SERVER,
        "      if (out.length >= cap) return out;\n"
        "      out.push(typeof record.v === 'string' ? record.v : '');\n",
        "      out.push(typeof record.v === 'string' ? record.v : '');\n"
        "      if (out.length >= cap) return out;\n",
        "a limit of zero records is a limit of zero, not of one",
        INCREMENTAL_PROBE,
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


def run_probe(probe=PROBE):
    proc = subprocess.run(
        ["node", str(probe)],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def reported_rules(output):
    """The rules a probe named as broken.

    Two guards, two formats: `verify-trajectory-cache.mjs` prints `  - <name>` and
    `verify-incremental.mjs` prints `FAIL <name>`. Both name the rule, so a control that could
    only read one of them would read the other's output as a failure that named nothing.
    """
    names = []
    for line in output.splitlines():
        text = line.strip()
        if text.startswith("- "):
            names.append(text[2:].strip())
        elif text.startswith("FAIL "):
            names.append(text[5:].strip())
    return names


def probes_used():
    """The probes the cases ask for, in the order they first appear."""
    used = []
    for case in MUTATIONS:
        probe = case[5] if len(case) > 5 else PROBE
        if probe not in used:
            used.append(probe)
    return used


def main():
    code, output = run_probe(PROBE)
    if code != 0:
        print("baseline probe does not pass; fix that first")
        print(output)
        return 1
    print("baseline clean")

    # Every probe a case names is baselined before any mutation is applied: a probe that is
    # already red cannot be read as a catch, and a control that ran one would report a mutation
    # as survived for a reason that has nothing to do with it.
    for probe in probes_used():
        if probe == PROBE:
            continue
        code, output = run_probe(probe)
        if code != 0:
            print(f"baseline {probe.name} does not pass; fix that first")
            print(output)
            return 1
        print(f"baseline {probe.name} clean")

    originals = {path: path.read_bytes() for path in {m[1] for m in MUTATIONS}}
    missed = []
    unnamed = []
    for case in MUTATIONS:
        label, path, old, new = case[:4]
        expect = case[4] if len(case) > 4 else None
        probe = case[5] if len(case) > 5 else PROBE
        text, newline = read_exact(path)
        if old not in text:
            print(f"SKIP  {label}: anchor not found in {path.name}")
            missed.append(label)
            continue
        write_exact(path, text.replace(old, new, 1), newline)
        try:
            code, output = run_probe(probe)
        finally:
            path.write_bytes(originals[path])
        if code == 0:
            print(f"MISSED {label}: the probe still passed")
            missed.append(label)
            continue
        if expect is not None:
            # The case names the rule it is about, so the probe has to name that rule and not
            # some other one that happened to go red in the same run.
            names = reported_rules(output)
            if expect not in names:
                print(f"MISSED {label}: the probe named {names} instead of {expect}")
                missed.append(label)
                continue
            print(f"caught {label}\n         -> {expect}")
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
