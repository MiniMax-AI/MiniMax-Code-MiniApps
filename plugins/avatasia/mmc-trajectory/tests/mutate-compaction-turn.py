"""Mutation control for the compaction-turn fix and the band that renders it.

Each mutation reintroduces exactly one thing the probes are supposed to catch. The probe must FAIL
every time, and the file must come back byte-for-byte afterwards.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SERVER = ROOT / "miniapp" / "node" / "server.mjs"
CLIENT = ROOT / "miniapp" / "client" / "index.html"
PROBES = [
    HERE / "verify-compaction-turn.mjs",
    HERE / "client-check.mjs",
]

MUTATIONS = [
    (
        "server: key the turn on the whole id again (the phantom turn returns)",
        SERVER,
        "    const turn = ensureTurn(turnKey);",
        "    const turn = ensureTurn(turnId);",
    ),
    (
        "server: strip the suffix from any id, not just a checkpoint",
        SERVER,
        "    const turnKey = role === 'compactionSummary'\n",
        "    const turnKey = (role === 'compactionSummary' || true)\n",
    ),
    (
        "server: drop the length guard, so ':compaction' collapses into the turn-less bucket",
        SERVER,
        "      && turnId.length > COMPACTION_TURN_SUFFIX.length\n",
        "",
    ),
    (
        "server: a turn containing a checkpoint is called a checkpoint again",
        SERVER,
        "    } else if (isCompaction && turn.records.length === 1) {",
        "    } else if (isCompaction) {",
    ),
    (
        "server: leave the file's suffixed id on the record",
        SERVER,
        "      turnId: turnKey,",
        "      turnId,",
    ),
    (
        "client: the compaction term goes back to counting turns",
        CLIENT,
        "        if (isCount(stats.compactions) && stats.compactions > 0) {",
        "        if (isCount(stats.compactionTurns) && stats.compactionTurns > 0) {",
    ),
    (
        "client: the band loses the generation it opened",
        CLIENT,
        "        var opened = isCount(record.generation)",
        "        var opened = false",
    ),
    (
        # Re-anchored: the routing moved out of renderLedger() and into fillGroupRows(), which
        # is the one place a group's rows are built. The rule did not change, only where it
        # lives. The decision and the branch that uses it are two lines apart here, so the
        # branch is what gets broken — and the guard that owns the rule now reads the branch
        # rather than the word.
        "client: the ledger stops routing checkpoints to the band",
        CLIENT,
        "          if (isBand) {\n",
        "          if (false) {\n",
    ),
]


def read_exact(path):
    """Read with every line ending normalised to \\n, and remember which style the file used.

    `Path.read_text` folds CRLF into LF and `Path.write_text` puts the platform's line ending
    back, so the usual pair silently rewrites a file's endings for the duration of a mutation.
    That is not cosmetic here: server.mjs is CRLF and index.html is LF, several guards match CSS
    rules with a literal `\\n`, and matching an anchor written with `\\n` against a CRLF file finds
    nothing. So: match on the normalised text, write back in the file's own style.
    """
    raw = path.read_bytes().decode("utf-8")
    return raw.replace("\r\n", "\n"), ("\r\n" if "\r\n" in raw else "\n")


def write_exact(path, text, newline):
    with open(path, "wb") as handle:
        handle.write(text.replace("\n", newline).encode("utf-8"))


def run_probe():
    for probe in PROBES:
        result = subprocess.run(
            ["node", str(probe)], cwd=str(HERE), capture_output=True, text=True
        )
        if result.returncode != 0:
            return probe.name, result.stdout + result.stderr
    return None, ""


def main():
    name, output = run_probe()
    if name:
        print(f"baseline {name} does not pass; fix that first")
        print(output)
        return 1
    print("baseline clean")

    originals = {path: path.read_bytes() for path in {m[1] for m in MUTATIONS}}
    missed = []
    for label, path, old, new in MUTATIONS:
        text, newline = read_exact(path)
        if text.count(old) != 1:
            print(f"SKIP  {label}: anchor appears {text.count(old)} times, expected 1")
            missed.append(label)
            continue
        write_exact(path, text.replace(old, new, 1), newline)
        try:
            name, output = run_probe()
        finally:
            path.write_bytes(originals[path])
        if name is None:
            print(f"MISSED {label}: every probe still passed")
            missed.append(label)
        else:
            detail = [line.strip() for line in output.splitlines() if line.strip().startswith("-")]
            print(f"caught {label}\n         -> {name}: {detail[0] if detail else '(no detail)'}")

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