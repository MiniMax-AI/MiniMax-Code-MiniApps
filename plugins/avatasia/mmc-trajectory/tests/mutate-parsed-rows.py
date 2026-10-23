"""Mutation control for verify-parsed-rows.mjs.

Each mutation reintroduces exactly one bug the probe is supposed to catch, BY NAME. The ones that
matter most are the first three: each of them makes the endpoint answer something plausible and
wrong, and none of them throws.

  - searching the STORED rows instead of the projected view reports versions the ledger is not
    showing, and hands back an index no row occupies;
  - dropping one of the five searched fields narrows what a reader can find with no error at all;
  - counting only what fits under the cap turns "how many matched" into "how many did we send".

Every case names the rule it is about in its `expect` field, and a case counts as caught only
when the probe reported THAT rule: a probe that went red on some other assertion has not shown
that this guard owns this mutation. The rules the last six cases are about are the ones this
cache has to answer about ITSELF rather than about the page's bytes:

  - the cache is charged the SOURCE bytes it holds (times the heap proxy), so the part of a
    lineage a round does not have to parse again is a number and not a guess;
  - the rows are released when nobody has wanted them for a while, without a request, because a
    release that only ran on a request would happen exactly when the reader comes back;
  - that release is longer than one poll, or an open tab would lose its rows between polls;
  - and the timer that does it never keeps the process alive.
  - the sweep interval is floored at a millisecond on both sides: the quarter of a limit below
    four milliseconds is finer than a timer can be, and an interval a caller asks for that is not
    positive used to switch the sweeper off — which left the rows to be released only when
    somebody asked for them.
"""
import json
import re
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
        "  return `${filePath}|${size}|${mtimeMs}|${limit}`;",
        "  return `${filePath.split(/[\\\\/]/).pop()}|${size}|${mtimeMs}|${limit}`;",
        'the path is part of the key (two sessions, one basename)',
    ),
    (
        "server: the key stops carrying the size, so a grown file serves a stale tail",
        "  return `${filePath}|${size}|${mtimeMs}|${limit}`;",
        "  return `${filePath}|${mtimeMs}|${limit}`;",
        'the size is part of the key (the active file grows)',
    ),
    (
        "server: the key stops carrying the mtime, so a same-size rewrite serves stale rows",
        "  return `${filePath}|${size}|${mtimeMs}|${limit}`;",
        "  return `${filePath}|${size}|${limit}`;",
        'the mtime is part of the key (a rewrite at the same size)',
    ),
    (
        "server: the key stops carrying the limit, so the truncation verdict is read at another width",
        "  return `${filePath}|${size}|${mtimeMs}|${limit}`;",
        "  return `${filePath}|${size}|${mtimeMs}|64 * 1024 * 1024`;",
        'the limit is part of the key (readHead truncates at it)',
    ),
    # ---- the cache value ----------------------------------------------------------
    (
        "server: `empty` is not carried on the cached value, so a hit stops reporting it",
        "    empty: head.buffer.length === 0,\n",
        "    empty: false,\n",
        'an empty file still reports empty on a hit',
    ),
    (
        "server: `skipped` is not carried, so a read under-counts the lines it dropped",
        "    skipped: parsed.skipped,\n",
        "    skipped: 0,\n",
        'two lines are skipped: one unparseable, one not an object',
    ),
    (
        # The value carries the count the parse reported, so the only way a HIT can disagree with
        # a cold read is if the hit path stops handing back what it was given.
        "a hit reports a skipped count of its own rather than the one it was given",
        "    if (hit !== null) return hit;\n",
        "    if (hit !== null) return { ...hit, skipped: 0 };\n",
        'a hit reports the same skipped count as a cold read',
    ),
    # ---- the budget ---------------------------------------------------------------
    (
        "the budget stops evicting, so the cache grows without limit",
        """      while (bytes > budget && entries.size > 1) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        const victim = entries.get(oldest.value);
        entries.delete(oldest.value);
        bytes -= victim ? victim.size : 0;
      }
""",
        "",
        'the third evicts the oldest, keeping the budget',
    ),
    (
        "reading stops refreshing recency, so the 22 frozen files get evicted by insertion order",
        """      // Re-reading is the only signal that a file is still hot, so it refreshes recency.
      entries.delete(key);
      entries.set(key, hit);
      hit.at = now();
      return hit.value;
""",
        "      return hit.value;\n",
        'a file that was just read survives the eviction that follows',
    ),
    (
        "an entry larger than the whole budget is stored anyway, evicting everything for one hit",
        "      if (size > budget) return bytes;\n",
        "",
        'a single entry larger than the budget is not stored',
    ),
    (
        "re-storing a key double-counts it, so the budget shrinks over time",
        """      const previous = entries.get(key);
      if (previous !== undefined) {
        bytes -= previous.size;
        entries.delete(key);
      }
""",
        "",
        're-storing the same key counts once',
    ),
    # ---- structure ----------------------------------------------------------------
    (
        "the cache becomes a module-level singleton, shared across every runtime instance",
        "  const parsedRows = createParsedRowsCache(PARSED_ROWS_CACHE_BYTES);",
        "  globalThis.__parsedRows = globalThis.__parsedRows || createParsedRowsCache(PARSED_ROWS_CACHE_BYTES);\n  const parsedRows = globalThis.__parsedRows;",
        'the cache is created inside start(), not at module level',
    ),
    (
        "the route parses the file inline again instead of going through the cache",
        "        parsedFile = await loadParsedRows(parsedRows, filePath, limit, { cacheable: link.fileName !== activeFileName });",
        "        parsedFile = await (async () => { const h = await readHead(filePath, limit); const p = parseMessagesJsonl(h.buffer); return { rows: p.rows, locators: p.spans.map(([s, e]) => ({ start: s, end: e, digest: lineDigest(h.buffer.subarray(s, e)) })), skipped: p.skipped, size: h.size, read: h.read, empty: h.buffer.length === 0, truncated: truncatedByCap(h.size, limit) }; })();",
        'the route reaches the file through loadParsedRows()',
    ),
    # ---- the coverage the cache can state about itself ---------------------------------
    (
        # The budget is charged in SOURCE bytes times the heap proxy. That is what makes the
        # coverage computable: the source bytes a round does not have to parse again are the
        # lineage's source bytes minus the source bytes this cache holds. Charge the source
        # bytes alone and the number a reader can compute no longer matches what the cache holds.
        "the cache is charged the source bytes without the heap proxy, so its accounting drifts from its input",
        "  if (cacheable) cache.set(key, value, Math.ceil(head.size * PARSED_ROWS_HEAP_PER_SOURCE_BYTE));",
        "  if (cacheable) cache.set(key, value, head.size);",
        'the cache is charged the source bytes times the heap proxy',
    ),
    # ---- the rows are released when nobody wants them ------------------------------------
    (
        # The read path has to notice that the rows have been here longer than anybody asked
        # for them. Without this the cache keeps a conversation's rows for as long as the
        # runtime lives, which is how the last session a reader opened stayed resident.
        "a read does not notice that the rows have expired",
        "      if (expired(hit.at)) {\n",
        "      if (false) {\n",
        'a read after the time limit is a miss',
    ),
    (
        # The sweep is what releases the rows while the reader is gone. A sweep that releases
        # nothing is a sweep that does not exist.
        "the sweep releases nothing",
        "      if (expired(entry.at)) drop(key);\n",
        "      if (false) drop(key);\n",
        'a sweep releases what expired',
    ),
    (
        # Without the timer, the rows are only released by the next request — which is exactly
        # the moment the reader comes back and wants them again.
        "the sweeper is never started, so the rows stay until the next request",
        "      startSweeper();\n",
        "",
        'the rows are released without a request',
    ),
    (
        # An interval that is not unref'd keeps the event loop alive after the server closes,
        # and the runtime would wait for it.
        "the sweeper keeps the process alive",
        "    if (typeof sweeper.unref === 'function') sweeper.unref();\n",
        "",
        'the sweeper does not keep the process alive',
    ),
    (
        # The page polls every 8 seconds. A limit shorter than one poll would make an open tab
        # lose its rows between two polls and re-parse the whole lineage for nothing.
        "the time limit is shorter than one poll",
        "const PARSED_ROWS_CACHE_TTL_MS = 10 * 60 * 1000;",
        "const PARSED_ROWS_CACHE_TTL_MS = 1000;",
        'the time limit is longer than one poll, so an open tab never loses its rows',
    ),
    (
        # The page stops polling while its tab is hidden, so a reader who switches away for a
        # while is the ordinary case. A minute is short enough that every return to the tab
        # costs a re-parse — which is the other half of what this limit buys.
        "the time limit is short enough that switching away from the tab costs a re-parse",
        "const PARSED_ROWS_CACHE_TTL_MS = 10 * 60 * 1000;",
        "const PARSED_ROWS_CACHE_TTL_MS = 60 * 1000;",
        'the time limit is at least five minutes, so stepping away from the tab does not cost a re-parse',
    ),
    (
        # The relation between the limit and the sweep interval has to hold for the interval the
        # cache ACTUALLY uses. Reading two numbers out of the source would keep passing after the
        # line that TAKES the interval had changed, so the mutation is on that line.
        #
        # The case that used to change the constant's value is not a defect any more and is gone
        # for that reason, not because its rule lost an owner: the interval is clamped to the
        # limit where it is taken, so a longer constant is simply never used. The rule itself is
        # still owned — by this case.
        "the sweep interval is taken without being clamped to the limit",
        """  const limitBoundMs = Math.max(1, Math.floor(ttlMs / 4));
  const askedBoundMs = Math.max(1, options.sweepIntervalMs ?? PARSED_ROWS_CACHE_SWEEP_INTERVAL_MS);
  const sweepIntervalMs = Math.min(limitBoundMs, askedBoundMs);""",
        """  const askedBoundMs = Math.max(1, options.sweepIntervalMs ?? PARSED_ROWS_CACHE_SWEEP_INTERVAL_MS);
  const sweepIntervalMs = askedBoundMs;""",
        'the sweep interval the cache uses is at most a quarter of the limit',
    ),
    (
        # The floor of a millisecond is what makes the promise true for a limit below four
        # milliseconds: a quarter of such a limit is finer than a timer can be, so the floor is
        # the larger of the two. Without the floor the interval would be zero there, and a zero
        # interval is not a fast timer — it is no timer at all.
        "the limit bound loses its floor of a millisecond",
        "  const limitBoundMs = Math.max(1, Math.floor(ttlMs / 4));",
        "  const limitBoundMs = Math.floor(ttlMs / 4);",
        'a limit too small for a quarter of a millisecond still sweeps no finer than a millisecond',
    ),
    (
        # A caller who asks for an interval that is not positive used to switch the sweeper off,
        # and a cache whose sweeper is off only releases the rows when somebody asks for them —
        # the one moment they are wanted again. The floor on what the caller asked for is what
        # keeps the sweeper running.
        "the asked interval loses its floor of a millisecond",
        "  const askedBoundMs = Math.max(1, options.sweepIntervalMs ?? PARSED_ROWS_CACHE_SWEEP_INTERVAL_MS);",
        "  const askedBoundMs = options.sweepIntervalMs ?? PARSED_ROWS_CACHE_SWEEP_INTERVAL_MS;",
        'an interval the caller asks for that is not positive is taken as a millisecond',
    ),
    (
        # A time limit of zero means NO time limit. The other reading — everything expires at
        # once — would be a cache that never hits and never releases.
        "a time limit of zero expires everything anyway",
        "  const expired = (at) => ttlMs > 0 && now() - at >= ttlMs;",
        "  const expired = (at) => now() - at >= ttlMs;",
        'a time limit of zero means no time limit, not that everything expires at once',
    ),
    (
        # The number the package promises a reader is the limit plus the interval, and it is
        # written down in prose where a reader meets it. Change the prose and the code keeps
        # its promise while the promise itself says something else — so the prose has to be
        # compared with the code, not trusted.
        "the promise to a reader says a number the code does not have",
        "(750000 ms) with the shipped",
        "(600000 ms) with the shipped",
        'the number promised to a reader is the limit plus one sweep interval',
    ),
    (
        # The other half of the same tie: the limit moves and the promise stays where it was.
        # The rows would still be released on a sweep, and the reader would still be promised
        # twelve and a half minutes.
        "the limit is longer than the promise to a reader",
        "const PARSED_ROWS_CACHE_TTL_MS = 10 * 60 * 1000;",
        "const PARSED_ROWS_CACHE_TTL_MS = 20 * 60 * 1000;",
        'the number promised to a reader is the limit plus one sweep interval',
    ),

    (
        # The promise to a reader is that the rows are gone no later than one sweep interval after
        # the limit -- and that holds only if the TIMER runs on that interval. Nothing watched the
        # call that starts the timer, so doubling the interval there left every other case green:
        # the cache still reported the interval it was asked for, the number in the prose still
        # matched that reported interval, and the real release had moved to "the limit plus twice
        # the interval" while the promise went on saying twelve and a half minutes.
        "the timer that releases the rows runs on twice the interval the cache reports",
        "    sweeper = setInterval(sweep, sweepIntervalMs);",
        "    sweeper = setInterval(sweep, sweepIntervalMs * 2);",
        'the timer that releases the rows runs on the interval the cache reports',
    ),
]


def read_exact(path):
    """Normalise to LF for matching, and report the file's own newline so it can be put back.

    Matching against the raw bytes would make every multi-line anchor miss — which the runner
    reports as a surviving mutation, so the failure looks like a dead guard rather than a
    broken anchor.
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


def rule_name(text):
    """The name of a rule a probe reported, without the evidence a comparison carries.

    A probe reports an assertion as `<name>` and a comparison as
    `<name>: got <value>, want <value>`. The values are the evidence, not the rule, so they are
    cut off — and the cut is made at a `: got ` whose tail really is `<json>, want <json>`, so a
    name that itself contains those words is not truncated.
    """
    for match in reversed(list(re.finditer(re.escape(": got "), text))):
        head = text[:match.start()].strip()
        tail = text[match.end():]
        cut = tail.rfind(", want ")
        if cut < 0:
            continue
        try:
            json.loads(tail[:cut])
            json.loads(tail[cut + len(", want "):])
        except ValueError:
            continue
        return head
    return text


def reported_rules(output):
    """The rules a probe named as broken.

    Two formats, as in `mutate-search-endpoint.py`: `  - <name>` and `FAIL <name>`. A case is
    only caught when the rule it names is among them.
    """
    names = []
    for line in output.splitlines():
        text = line.strip()
        if text.startswith("- "):
            names.append(rule_name(text[2:].strip()))
        elif text.startswith("FAIL "):
            names.append(rule_name(text[5:].strip()))
    return names


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
    for label, old, new, expect in MUTATIONS:
        text, newline = read_exact(SERVER)
        # The anchor has to be there EXACTLY once. A control that replaces the first occurrence of
        # a string that occurs twice edits a place it did not mean to edit, and the case then
        # passes or fails for a reason that has nothing to do with the rule it is about -- so the
        # count is checked here, by the control itself, instead of being counted by somebody
        # reading the source.
        if text.count(old) != 1:
            print(f"SKIP  {label}: anchor found {text.count(old)} times")
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
        names = reported_rules(output)
        if not names:
            print(f"UNNAMED {label}: the probe failed without naming a rule")
            unnamed.append(label)
            continue
        # The case names the rule it is about, so the probe has to name THAT rule and not some
        # other one that happened to go red in the same run: a probe that went red elsewhere has
        # not shown that this guard owns this mutation.
        if expect not in names:
            print(f"MISSED {label}: the probe named {names} instead of {expect}")
            missed.append(label)
            continue
        print(f"caught {label}\n         -> {expect}")

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
