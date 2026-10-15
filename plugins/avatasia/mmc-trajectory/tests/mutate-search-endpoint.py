"""Mutation control for verify-search-endpoint.mjs.

Each mutation reintroduces exactly one bug the probe is supposed to catch, BY NAME. The ones that
matter most are the first three: each of them makes the endpoint answer something plausible and
wrong, and none of them throws.

  - searching the STORED rows instead of the projected view reports versions the ledger is not
    showing, and hands back an index no row occupies;
  - dropping one of the five searched fields narrows what a reader can find with no error at all;
  - counting only what fits under the cap turns "how many matched" into "how many did we send".
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SERVER = ROOT / "miniapp" / "node" / "server.mjs"
PROBE = HERE / "verify-search-endpoint.mjs"

SEARCH_LOOP = """  for (const turn of turns) {
    const records = Array.isArray(turn.records) ? turn.records : [];
    for (const record of records) {
      if (!searchSurfaceOf(record).includes(needle)) continue;
      total += 1;
      if (hits.length >= limit) continue;"""

MUTATIONS = [
    # ---- a hit has to be a row the reader can be sent to ------------------------------------
    (
        "the endpoint is wired to a scan of the stored rows rather than the projected view",
        "    const searched = collectSearchHits(payload, needle, MAX_SEARCH_HITS);",
        "    const searched = collectSearchHits({ turns: [{ index: 1, records: rows.map((row) => ({ index: 0, kind: 'reply', summary: String(row.message_id) })) }] }, needle, MAX_SEARCH_HITS);",
    ),
    (
        "a hit reports the record's stored id instead of the index the ledger gives it",
        "        index: record.index,\n        turnIndex: turn.index,",
        "        index: record.id === null || record.id === undefined ? 0 : 1,\n        turnIndex: turn.index,",
    ),
    (
        "the endpoint projects the whole lineage instead of the slice that was asked for",
        "    const view = selectIdentityView(identityTable, filter);\n    const payload = buildTrajectoryPayload({\n      session: { id: ctx.identity.id, createdAtMs: entry.lastActiveAt },",
        "    const view = selectIdentityView(identityTable, null);\n    const payload = buildTrajectoryPayload({\n      session: { id: ctx.identity.id, createdAtMs: entry.lastActiveAt },",
    ),
    # ---- the surface has to be the page's ---------------------------------------------------
    (
        "the endpoint searches only the summary",
        "      if (!searchSurfaceOf(record).includes(needle)) continue;",
        "      if (!String(record.summary ?? '').includes(needle)) continue;",
    ),
    (
        "the endpoint folds the surface away, so a case-sensitive needle matches everything",
        "      if (!searchSurfaceOf(record).includes(needle)) continue;",
        "      if (!String(record.summary ?? '').toLowerCase().includes(needle) || true) continue;",
    ),
    # ---- how many ---------------------------------------------------------------------------
    (
        "the cap also bounds the count, so a long needle reports however many fitted",
        SEARCH_LOOP,
        """  for (const turn of turns) {
    const records = Array.isArray(turn.records) ? turn.records : [];
    for (const record of records) {
      if (!searchSurfaceOf(record).includes(needle)) continue;
      if (hits.length >= limit) break;
      total += 1;""",
    ),
    (
        "the cap is applied before the count, so an unlimited search reports nothing",
        "      total += 1;\n      if (hits.length >= limit) continue;",
        "      if (hits.length < limit) total += 1;\n      if (hits.length >= limit) continue;",
    ),
    # ---- a needle never crosses a record ------------------------------------------------------
    (
        "records are joined into one blob before the scan, so a needle can cross a boundary",
        "  for (const turn of turns) {\n    const records = Array.isArray(turn.records) ? turn.records : [];\n    for (const record of records) {\n      if (!searchSurfaceOf(record).includes(needle)) continue;\n      total += 1;",
        "  const blob = turns.flatMap((t) => (Array.isArray(t.records) ? t.records : [])).map((r) => searchSurfaceOf(r)).join(' ');\n  if (blob.includes(needle)) { hits.push({ index: 0, turnIndex: 1, kind: 'reply', summary: '', generation: null }); total += 1; }\n  for (const turn of []) {\n    const records = [];\n    for (const record of records) {\n      if (!searchSurfaceOf(record).includes(needle)) continue;\n      total += 1;",
    ),
    # ---- the route ---------------------------------------------------------------------------
    (
        "the route is not registered, so a search answers 404",
        "    if (url.pathname === '/api/trajectory/search') {",
        "    if (url.pathname === '/api/trajectory/searchX') {",
    ),
    (
        "a needle too short is answered with everything instead of refused",
        "    if (!needleIsUsable(asked)) {",
        "    if (false) {",
    ),
    (
        "the lineage is walked a second time, so the two readers can disagree about it",
        "      walked = await collectLineage(entry, ctx.generations);\n    } catch (error) {\n      sendError(response, 500, 'trajectory_unreadable', lineageFailure(error));\n      return;\n    }\n    const { occurrences, files } = walked;",
        "      walked = await collectLineage(entry, ctx.generations);\n      walked = await collectLineage(entry, ctx.generations);\n    } catch (error) {\n      sendError(response, 500, 'trajectory_unreadable', lineageFailure(error));\n      return;\n    }\n    const { occurrences, files } = walked;",
    ),
    (
        "the session key becomes the session id, so an id becomes a directory name",
        "    createHash('sha256').update(`${dir}\\n${sessionId}`).digest('hex').slice(0, 32);",
        "    String(sessionId);",
    ),
    (
        "the artifacts are written beside the session history instead of under the data dir",
        "  const artifactRoot = join(context.dataDir, 'trajectory-artifacts');",
        "  const artifactRoot = join(process.cwd(), 'trajectory-artifacts');",
    ),
    (
        # Used to be the other way round: §8.8.1 rule 5 kept the active generation out of the store,
        # and this mutation removed that skip. The rule is inverted now — the active generation IS
        # stored, because `sameSource` reads its own size and a grown file invalidates itself — so
        # the mutation puts the skip back and the guard has to notice the early exit it now forbids.
        "the active generation is skipped again, so a session still being written has nothing to scan",
        "    for (let fileIdx = 0; fileIdx < files.length; fileIdx += 1) {\n      const records = [];",
        "    for (let fileIdx = 0; fileIdx < files.length; fileIdx += 1) {\n      if (fileIdx === 0) continue;\n      const records = [];",
    ),
    (
        # The rule is that `total` counts every match, so a missing generation cannot be tolerated:
        # answering from 44 of 45 reports a smaller number and says nothing about being wrong.
        "one missing segment no longer makes the search fall back",
        "      if (segment === null) return null;",
        "      if (segment === null) continue;",
    ),
    (
        "the artifact path reports how many it sent instead of how many matched",
        "    return { hits, total };",
        "    return { hits, total: hits.length };",
    ),
    (
        # The summary a hit answers with now lives on the segment line, so the mutation that swaps it
        # for the kind belongs with the module that writes it — mutate-search-segments.py.
        "writing the artifacts can fail the search that asked for them",
        "    }).catch(() => undefined);",
        "    });",
    ),
    # ---- the scan is resolved in one batch ---------------------------------------------------
    (
        # The route's half of the batch rule. The answers it builds are the same answers either way —
        # which is why the cost cannot be asserted here and lives in verify-search-segments.mjs
        # instead. What changes here is the shape: a walk per hit rather than one walk for the scan.
        "the route resolves the scan one ordinal at a time, walking the segment once per hit",
        "      const answers = readSegmentHits(segment.surface, ordinals);",
        "      const answers = ordinals.map((ordinal) => {\n"
        "        let from = 0;\n"
        "        let line = 0;\n"
        "        while (from <= segment.surface.length) {\n"
        "          const nl = segment.surface.indexOf('\\n', from);\n"
        "          if (line === ordinal) {\n"
        "            const tab = segment.surface.indexOf('\\t', from);\n"
        "            const parsed = tab < 0 ? null : JSON.parse(segment.surface.slice(from, tab));\n"
        "            return { index: parsed.index, turnIndex: parsed.turnIndex, kind: parsed.kind, summary: parsed.summary, generation: parsed.generation };\n"
        "          }\n"
        "          if (nl === -1) break;\n"
        "          from = nl + 1;\n"
        "          line += 1;\n"
        "        }\n"
        "        return null;\n"
        "      });",
    ),
    (
        # A hit that cannot be resolved is a segment written by something this reader disagrees
        # with. Dropping it would answer with a smaller `total` and say nothing about being wrong.
        "a hit the reader could not resolve is skipped instead of falling back",
        "        if (hit === null) return null;",
        "        if (hit === null) continue;",
    ),
    (
        # The shape that was removed: a second store under the artifact root, filled on every
        # publish, read by nothing — 8.6 MB a session a view on disk. Rebuilt here from live code
        # rather than by re-adding the deleted module, so the mutation is a regression someone could
        # actually write instead of a revert. It trips both halves of the rule: the store's name and
        # the second directory it makes.
        "a second artifact store is written beside the segments, and nothing reads it",
        "      const segment = buildSegment({ records });\n      await segmentStore.write(sessionKey, viewKey, generationKeyValue, segment, {\n        generation,\n        source: [files[fileIdx]],\n      });",
        "      const segment = buildSegment({ records });\n      await segmentStore.write(sessionKey, viewKey, generationKeyValue, segment, {\n        generation,\n        source: [files[fileIdx]],\n      });\n      const indexStore = createSegmentStore(join(artifactRoot, 'index'));\n      await indexStore.write(sessionKey, viewKey, generationKeyValue, segment, {\n        generation,\n        source: [files[fileIdx]],\n      });",
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

    original = SERVER.read_bytes()
    missed = []
    unnamed = []
    for label, old, new in MUTATIONS:
        text, newline = read_exact(SERVER)
        if old not in text:
            print(f"SKIP  {label}: anchor not found")
            missed.append(label)
            continue
        if old == new:
            print(f"SKIP  {label}: the mutation changes nothing")
            missed.append(label)
            continue
        write_exact(SERVER, text.replace(old, new, 1), newline)
        try:
            code, output = run_probe()
        finally:
            SERVER.write_bytes(original)
        if code == 0:
            print(f"MISSED {label}: the probe still passed")
            missed.append(label)
            continue
        first = next((line.strip() for line in output.splitlines() if line.strip().startswith("- ")), None)
        if first is None:
            print(f"UNNAMED {label}: the probe failed without naming a rule")
            unnamed.append(label)
        else:
            print(f"caught {label}\n         -> {first}")

    if SERVER.read_bytes() != original:
        print(f"NOT RESTORED {SERVER}")
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
